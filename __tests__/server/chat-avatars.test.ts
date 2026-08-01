import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createChatAvatarRouter } from '../../src/server/routes/chat-avatars';

describe('chat avatar routes', () => {
  let dataDir = '';
  let app: express.Express;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-chat-avatars-'));
    app = express();
    app.use('/api/chat-avatars', createChatAvatarRouter({ dataDir }));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('stores, lists, serves and deletes a private custom avatar', async () => {
    const empty = await request(app)
      .get('/api/chat-avatars')
      .query({ userId: 'avatar-user' })
      .expect(200);
    expect(empty.body.avatars).toEqual([]);

    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZkAAAAASUVORK5CYII=',
      'base64',
    );
    const uploaded = await request(app)
      .post('/api/chat-avatars')
      .field('userId', 'avatar-user')
      .attach('avatar', tinyPng, {
        filename: 'custom.png',
        contentType: 'image/png',
      })
      .expect(201);

    expect(uploaded.body.success).toBe(true);
    expect(uploaded.body.avatar.id).toMatch(/^avatar-[0-9a-f-]{36}\.png$/);
    expect(uploaded.body.avatar.url).toContain('/api/chat-avatars/file/');

    const listed = await request(app)
      .get('/api/chat-avatars')
      .query({ userId: 'avatar-user' })
      .expect(200);
    expect(listed.body.avatars).toHaveLength(1);
    expect(listed.body.avatars[0].id).toBe(uploaded.body.avatar.id);

    const served = await request(app)
      .get(`/api/chat-avatars/file/${uploaded.body.avatar.id}`)
      .query({ userId: 'avatar-user' })
      .expect(200);
    expect(served.headers['content-type']).toMatch(/^image\/png/);
    expect(Buffer.compare(served.body, tinyPng)).toBe(0);

    await request(app)
      .delete(`/api/chat-avatars/file/${uploaded.body.avatar.id}`)
      .query({ userId: 'avatar-user' })
      .expect(200);

    const afterDelete = await request(app)
      .get('/api/chat-avatars')
      .query({ userId: 'avatar-user' })
      .expect(200);
    expect(afterDelete.body.avatars).toEqual([]);
  });

  it('rejects files whose contents are not supported images', async () => {
    const response = await request(app)
      .post('/api/chat-avatars')
      .field('userId', 'avatar-user')
      .attach('avatar', Buffer.from('not an image'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(415);

    expect(response.body.error.code).toBe('CHAT_AVATAR_FORMAT_UNSUPPORTED');
  });
});
