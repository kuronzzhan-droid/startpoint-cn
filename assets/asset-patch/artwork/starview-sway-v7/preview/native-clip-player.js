/* Embedded in the review after the capture payload. This file only plays recordings. */
(() => {
  'use strict';

  function waitFor(video, name, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      function clean() {
        video.removeEventListener(name, ready);
        video.removeEventListener('error', failed);
        signal.removeEventListener('abort', aborted);
      }
      function ready() { clean(); resolve(); }
      function failed() { clean(); reject(new Error(video.error?.message || '原生录像解码失败')); }
      function aborted() { clean(); reject(signal.reason); }
      video.addEventListener(name, ready, { once: true });
      video.addEventListener('error', failed, { once: true });
      signal.addEventListener('abort', aborted, { once: true });
    });
  }

  function createNativeClipPlayer(payload, { onFrame, onEnd, onError }) {
    const { fps, stageMask: [x, y, width, height], clips } = payload;
    const clipsByRole = new Map(clips.map(clip => [clip.roleId, clip]));
    let active;

    function emit(session, time) {
      const { clip, video } = session;
      const frame = Math.max(clip.firstFrame, Math.min(clip.lastFrame, clip.firstFrame + Math.round(time * fps)));
      session.state = {
        roleId: clip.roleId, frame, firstFrame: clip.firstFrame, lastFrame: clip.lastFrame,
        playing: !video.paused && !video.ended, events: clip.events,
      };
      onFrame(session.state);
    }

    function draw(ctx) {
      const video = active?.video;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(video, x, y, width, height);
      ctx.restore();
      return true;
    }

    function clear() {
      if (!active) return;
      const { video, url, controller, seekController, callback } = active;
      active = undefined;
      controller.abort();
      seekController?.abort();
      if (callback !== undefined) video.cancelVideoFrameCallback(callback);
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      URL.revokeObjectURL(url);
    }

    async function show(roleId) {
      clear();
      const clip = clipsByRole.get(String(roleId));
      if (!clip) throw new Error('缺少角色原生录像 ' + roleId);
      const bytes = Uint8Array.from(atob(clip.data), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.setAttribute('aria-hidden', 'true');
      video.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.001;pointer-events:none';
      const controller = new AbortController();
      const session = { clip, video, url, controller };
      active = session;
      const { signal } = controller;
      video.addEventListener('ended', () => {
        if (active !== session) return;
        emit(session, video.duration);
        onEnd(clip.roleId);
      }, { signal });
      const ready = waitFor(video, 'loadeddata', signal);
      document.body.append(video);
      video.src = url;
      try {
        await ready;
        if (video.videoWidth !== clip.width || video.videoHeight !== clip.height ||
            Math.abs(video.duration - (clip.lastFrame - clip.firstFrame + 1) / fps) > 0.002)
          throw new Error('原生录像尺寸或时长与记录不一致');
        const receiveFrame = (_now, metadata) => {
          if (active !== session) return;
          session.callback = video.requestVideoFrameCallback(receiveFrame);
          if (!video.paused && !video.seeking) emit(session, metadata.mediaTime);
        };
        session.callback = video.requestVideoFrameCallback(receiveFrame);
        video.addEventListener('error', () => onError(new Error(video.error?.message || '原生录像解码失败')), { signal });
        emit(session, 0);
      } catch (error) {
        if (signal.aborted) return;
        clear();
        throw error;
      }
    }

    function pause() {
      if (!active) return;
      active.video.pause();
      if (active.state) active.state.playing = false;
    }

    async function play(rate = 1) {
      const session = active;
      if (!session || !session.state) return;
      session.video.playbackRate = rate;
      try {
        await session.video.play();
      } catch (error) {
        if (active === session && error.name !== 'AbortError') throw error;
      }
    }

    async function seek(frame) {
      const session = active;
      if (!session || !session.state) return;
      const { clip, video } = session;
      if (!Number.isSafeInteger(frame) || frame < clip.firstFrame || frame > clip.lastFrame)
        throw new RangeError('超出原生录像的记录帧范围');
      pause();
      session.seekController?.abort();
      const seekController = new AbortController();
      session.seekController = seekController;
      // Seek inside the frame's exposure interval to tolerate WebM millisecond timecodes.
      const time = (frame - clip.firstFrame + 0.25) / fps;
      if (video.currentTime !== time || video.seeking) {
        const sought = waitFor(video, 'seeked', seekController.signal);
        video.currentTime = time;
        try {
          await sought;
        } catch (error) {
          if (seekController.signal.aborted) return;
          throw error;
        }
      }
      if (active === session) emit(session, (frame - clip.firstFrame) / fps);
    }

    return { show, clear, draw, pause, play, seek, state: () => active?.state };
  }

  window.createNativeClipPlayer = createNativeClipPlayer;
})();
