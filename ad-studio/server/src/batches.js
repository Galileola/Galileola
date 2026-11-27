import sharp from 'sharp';
import { db, now, parse } from './db.js';
import { newId, createJob, listJobs } from './jobs.js';
import { safeFetch } from './net.js';
import { enqueue } from './pipeline.js';

// A batch is a bulk order: one ad per product from a shop's product list.
// Product photos are downloaded one by one and each ad joins the queue.

function save(batch) {
  db.prepare('INSERT INTO batches (id, client_id, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
    .run(batch.id, batch.clientId, JSON.stringify(batch), batch.createdAt);
}

export function getBatch(id) {
  return parse(db.prepare('SELECT data FROM batches WHERE id = ?').get(id));
}

export function listBatches(limit = 20) {
  return db.prepare('SELECT data FROM batches ORDER BY created_at DESC LIMIT ?').all(limit).map(parse);
}

export function batchJobs(id) {
  return listJobs({ batchId: id, limit: 1000 });
}

/**
 * Starts a bulk order. makeRequest(product) returns the ad request for one
 * product; logo is the brand logo (Buffer or null).
 */
export function startBatch({ clientId, title, products, makeRequest, logo }) {
  const batch = { id: newId(), clientId, title, createdAt: now(), total: products.length, added: 0, failed: [] };
  save(batch);
  (async () => {
    for (const product of products) {
      try {
        const { buffer } = await safeFetch(product.image, { maxBytes: 20_000_000 });
        await sharp(buffer).metadata(); // make sure it is a picture
        const job = await createJob(makeRequest(product), { photo: buffer, logo, clientId, batchId: batch.id });
        enqueue(job);
        batch.added++;
      } catch (err) {
        console.error(`[batch ${batch.id}] ${product.title}:`, err.message);
        batch.failed.push({ title: product.title, error: err.userMessage || 'The product photo could not be downloaded.' });
      }
      save(batch);
    }
  })();
  return batch;
}
