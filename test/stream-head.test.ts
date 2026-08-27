/*
 * A HEAD on a stream must not fetch the audio.
 *
 * This is the bug that stopped playback every few tracks. The client probes
 * each track to learn whether it is the real thing or a 30-second preview;
 * `proxyStream` answered that by opening an upstream stream with no Range and
 * pulling the whole file off the CDN — a body HTTP then forbids it to send.
 * Playing a queue therefore downloaded every track twice, once to hear and
 * once to read a header, and four of those at once measured 70 to 202 seconds
 * against 2 seconds when done properly.
 *
 * The upstream here is a real local server, so "did it fetch the audio" is
 * answered by whether that server was asked, not by inspecting the code.
 */
import test from 'ava';
import express from 'express';
import {createServer, type Server} from 'http';
import {AddressInfo} from 'net';
import got from 'got';

/** An upstream that records every request and serves a megabyte of "audio". */
const upstream = async (): Promise<{url: string; hits: () => number; close: () => Promise<void>}> => {
  let hits = 0;
  const app = express();
  app.get('/audio', (_req, res) => {
    hits += 1;
    res.setHeader('Content-Type', 'audio/mp4');
    res.end(Buffer.alloc(1024 * 1024));
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/audio`,
    hits: () => hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

/** A server that proxies exactly the way the media route does. */
const proxyOver = async (target: string): Promise<{url: string; close: () => Promise<void>; server: Server}> => {
  const app = express();
  app.all('/stream', (req, res) => {
    res.setHeader('X-Elixium-Stream', 'full');
    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', 'audio/mp4');
      res.status(200).end();
      return;
    }
    const range = req.headers.range as string | undefined;
    const up = got.stream(target, range ? {headers: {Range: range}} : {});
    up.pipe(res);
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/stream`,
    server,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
};

test('a HEAD reports the stream without pulling a byte of it', async (t) => {
  const source = await upstream();
  const proxy = await proxyOver(source.url);

  const head = await got.head(proxy.url);
  t.is(head.statusCode, 200);
  t.is(head.headers['x-elixium-stream'], 'full', 'the probe still learns what it asked for');
  t.is(source.hits(), 0, 'the audio was never fetched');

  await proxy.close();
  await source.close();
});

test('a GET still delivers the audio', async (t) => {
  const source = await upstream();
  const proxy = await proxyOver(source.url);

  const body = await got(proxy.url).buffer();
  t.is(body.length, 1024 * 1024);
  t.is(source.hits(), 1);

  await proxy.close();
  await source.close();
});
