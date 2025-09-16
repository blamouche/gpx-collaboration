import request from 'supertest';
import express from 'express';
import health from '../src/health';

describe('/health', () => {
  it('should return status ok', async () => {
    const app = express();
    app.use('/health', health);
    const res = await request(app).get('/health');
    expect(res.body).toEqual({ status: 'ok' });
  });
});
