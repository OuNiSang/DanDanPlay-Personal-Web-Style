(function (global) {
    'use strict';

    // A metadata probe only. Unknown, mixed-track and unsupported containers keep
    // the native path. No decoder, media identity list or full-file download here.
    var LIMITS = Object.freeze({ requests: 8, bytes: 1048576, timeoutMs: 2500 });

    function failure(reason) { var error = new Error(reason); error.probeReason = reason; return error; }
    function text(bytes, start, length) {
        var result = '';
        for (var i = start; i < start + length; i += 1) result += String.fromCharCode(bytes[i]);
        return result;
    }
    function u32(bytes, start) {
        return bytes[start] * 16777216 + bytes[start + 1] * 65536 + bytes[start + 2] * 256 + bytes[start + 3];
    }
    function boxAt(bytes, start, end) {
        if (end - start < 8) throw failure('truncated-box');
        var size = u32(bytes, start), header = 8;
        if (size === 1) {
            if (end - start < 16) throw failure('truncated-large-box');
            size = u32(bytes, start + 8) * 4294967296 + u32(bytes, start + 12);
            header = 16;
        } else if (size === 0) size = end - start;
        if (!Number.isSafeInteger(size) || size < header || start + size > end) throw failure('invalid-box-size');
        return { type: text(bytes, start + 4, 4), start: start, body: start + header, end: start + size, size: size };
    }
    function children(bytes, start, end) {
        var list = [];
        while (start < end) {
            if (list.length >= 4096) throw failure('box-count-limit');
            var box = boxAt(bytes, start, end);
            list.push(box);
            start = box.end;
        }
        return list;
    }
    function one(boxes, type) {
        var found = boxes.filter(function (box) { return box.type === type; });
        if (found.length !== 1) throw failure('missing-or-duplicate-' + type);
        return found[0];
    }
    function readAudioCodecs(bytes) {
        var root = boxAt(bytes, 0, bytes.length);
        if (root.type !== 'moov' || root.end !== bytes.length) throw failure('invalid-moov');
        var tracks = children(bytes, root.body, root.end).filter(function (box) { return box.type === 'trak'; });
        if (!tracks.length) throw failure('no-tracks');
        var codecs = [];
        tracks.forEach(function (track) {
            var mdia = one(children(bytes, track.body, track.end), 'mdia');
            var media = children(bytes, mdia.body, mdia.end);
            var handler = one(media, 'hdlr');
            if (handler.end - handler.body < 12) throw failure('truncated-handler');
            if (text(bytes, handler.body + 8, 4) !== 'soun') return;
            var minf = one(media, 'minf');
            var stbl = one(children(bytes, minf.body, minf.end), 'stbl');
            var stsd = one(children(bytes, stbl.body, stbl.end), 'stsd');
            if (stsd.end - stsd.body < 8 || bytes[stsd.body] !== 0) throw failure('invalid-stsd');
            var count = u32(bytes, stsd.body + 4);
            var entries = children(bytes, stsd.body + 8, stsd.end);
            if (!count || count !== entries.length) throw failure('invalid-sample-count');
            entries.forEach(function (entry) {
                // AudioSampleEntry: reserved/data-reference + 20-byte audio fields.
                if (entry.end - entry.body < 28) throw failure('truncated-audio-entry');
                codecs.push(entry.type);
            });
        });
        return codecs;
    }

    async function inspect(source, options) {
        options = options || {};
        var controller, timer, externalListener, reader;
        var requests = 0, bytesRead = 0, total = null, container = 'unknown';
        var reason = null;
        function result(codec, why, codecs) {
            return { codec: codec, container: container, reason: why, audioCodecs: codecs || [], requests: requests, bytesRead: bytesRead };
        }
        try {
            if (!global.location || !global.location.href) return result('unknown', 'missing-origin');
            var url = new URL(source, global.location.href);
            if (url.origin !== global.location.origin || !/^https?:$/.test(url.protocol) || url.username || url.password) return result('unknown', 'non-same-origin');
            if (options.signal && options.signal.aborted) return result('unknown', 'aborted');
            if (global.document && global.document.createElement('video').canPlayType('audio/mp4; codecs="ec-3"')) return result('unknown', 'native-eac3-supported');
            if (typeof global.fetch !== 'function' || typeof global.AbortController !== 'function') return result('unknown', 'probe-unavailable');
            controller = new global.AbortController();
            externalListener = function () { reason = 'aborted'; controller.abort(); };
            if (options.signal) options.signal.addEventListener('abort', externalListener, { once: true });
            timer = global.setTimeout(function () { reason = 'timeout'; controller.abort(); }, LIMITS.timeoutMs);
            function abortable(promise) {
                return new Promise(function (resolve, reject) {
                    function abort() { reject(failure(reason || 'aborted')); }
                    if (controller.signal.aborted) { abort(); return; }
                    controller.signal.addEventListener('abort', abort, { once: true });
                    Promise.resolve(promise).then(resolve, reject).finally(function () { controller.signal.removeEventListener('abort', abort); });
                });
            }
            function cancelBody(body) {
                if (body && typeof body.cancel === 'function') Promise.resolve(body.cancel()).catch(function () {});
            }
            var cache = [];
            async function read(start, wanted) {
                if (!Number.isSafeInteger(start) || start < 0 || wanted <= 0) throw failure('invalid-range');
                for (var c = 0; c < cache.length; c += 1) {
                    if (start >= cache[c].start && start + wanted <= cache[c].start + cache[c].data.length) return cache[c].data.subarray(start - cache[c].start, start - cache[c].start + wanted);
                }
                if (requests >= LIMITS.requests) throw failure('request-limit');
                var length = Math.max(4096, wanted);
                if (total !== null) length = Math.min(length, total - start);
                if (length < wanted || length <= 0) throw failure('truncated-file');
                if (bytesRead + length > LIMITS.bytes) throw failure('byte-limit');
                var end = start + length - 1;
                requests += 1;
                var response = await abortable(global.fetch(url.href, {
                    method: 'GET', headers: { Range: 'bytes=' + start + '-' + end },
                    credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal
                }));
                if (response.status !== 206) { cancelBody(response.body); throw failure('range-not-supported'); }
                var match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
                if (!match) { cancelBody(response.body); throw failure('invalid-content-range'); }
                var first = Number(match[1]), last = Number(match[2]), size = Number(match[3]);
                if (!Number.isSafeInteger(size) || first !== start || last < first || last > end || last >= size || (total !== null && total !== size)) {
                    cancelBody(response.body); throw failure('invalid-content-range');
                }
                total = size;
                var expected = last - first + 1;
                if (expected < wanted || !response.body || typeof response.body.getReader !== 'function') {
                    cancelBody(response.body); throw failure('truncated-range');
                }
                var declared = Number(response.headers.get('Content-Length'));
                if (declared > expected) { cancelBody(response.body); throw failure('oversized-range'); }
                reader = response.body.getReader();
                var data = new Uint8Array(expected), offset = 0;
                try {
                    while (true) {
                        var chunk = await abortable(reader.read());
                        if (chunk.done) break;
                        if (offset + chunk.value.length > expected) throw failure('oversized-range');
                        data.set(chunk.value, offset);
                        offset += chunk.value.length;
                        bytesRead += chunk.value.length;
                    }
                } finally {
                    cancelBody(reader);
                    reader = null;
                }
                if (offset !== expected) throw failure('truncated-range');
                cache.push({ start: start, data: data });
                return data.subarray(0, wanted);
            }

            var offset = 0;
            for (var n = 0; n < 128; n += 1) {
                var headerBytes = await read(offset, 8);
                var size32 = u32(headerBytes, 0), headerSize = size32 === 1 ? 16 : 8;
                if (headerSize === 16) headerBytes = await read(offset, 16);
                var size = size32 === 1 ? u32(headerBytes, 8) * 4294967296 + u32(headerBytes, 12) : size32;
                if (size === 0) size = total - offset;
                if (!Number.isSafeInteger(size) || size < headerSize || offset + size > total) throw failure('invalid-box-size');
                var type = text(headerBytes, 4, 4);
                if (n === 0 && ['ftyp', 'free', 'skip', 'wide', 'moov', 'mdat'].indexOf(type) < 0) return result('unknown', 'unsupported-container');
                if (type === 'ftyp') container = 'mp4';
                if (type === 'moov') {
                    container = 'mp4';
                    var codecs = readAudioCodecs(await read(offset, size));
                    if (!codecs.length) return result('other', 'no-audio-track');
                    if (codecs.every(function (codec) { return codec === 'ec-3'; })) return result('eac3', 'mp4-eac3-audio-sample-entry', codecs);
                    if (codecs.indexOf('ec-3') >= 0) return result('unknown', 'mixed-audio-tracks', codecs);
                    return result('other', 'mp4-other-audio', codecs);
                }
                offset += size;
                if (offset === total) return result('unknown', 'moov-not-found');
            }
            return result('unknown', 'box-count-limit');
        } catch (error) {
            return result('unknown', reason || error.probeReason || 'request-failed');
        } finally {
            if (timer) global.clearTimeout(timer);
            if (options.signal && externalListener) options.signal.removeEventListener('abort', externalListener);
            if (controller) controller.abort();
            if (reader && typeof reader.cancel === 'function') Promise.resolve(reader.cancel()).catch(function () {});
        }
    }

    var api = { inspect: inspect, limits: LIMITS };
    global.DandanVideoCodecProbe = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
