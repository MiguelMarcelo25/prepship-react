import { randomUUID } from "node:crypto";
import type { PgPool } from "../../../../../../packages/shared/src/postgres/database.ts";
import type { QueueRepository } from "../application/queue-repository.ts";
import type { AddToQueueInput, MultiSkuItem, PrintQueueEntry } from "../domain/queue.ts";

interface PrintQueueRow {
  id: string;
  client_id: number;
  order_id: string;
  order_number: string | null;
  label_url: string;
  sku_group_id: string;
  primary_sku: string | null;
  item_description: string | null;
  order_qty: number;
  multi_sku_data: string | null;
  status: string;
  print_count: number;
  last_printed_at: number | null;
  queued_at: number;
  created_at: number;
}

export class PgQueueRepository implements QueueRepository {
  private readonly pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async add(input: AddToQueueInput): Promise<PrintQueueEntry> {
    const now = Math.floor(Date.now() / 1000);
    const id = randomUUID();

    await this.pool.query(
      `INSERT INTO print_queue_orders (
         id, client_id, order_id, order_number, label_url,
         sku_group_id, primary_sku, item_description, order_qty,
         multi_sku_data, status, print_count, last_printed_at,
         queued_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'queued', 0, NULL, $11, $12)
       ON CONFLICT (order_id, client_id) DO UPDATE SET
         label_url = EXCLUDED.label_url,
         sku_group_id = EXCLUDED.sku_group_id,
         primary_sku = EXCLUDED.primary_sku,
         item_description = EXCLUDED.item_description,
         order_qty = EXCLUDED.order_qty,
         multi_sku_data = EXCLUDED.multi_sku_data,
         status = 'queued',
         queued_at = EXCLUDED.queued_at`,
      [
        id,
        input.clientId,
        input.orderId,
        input.orderNumber ?? null,
        input.labelUrl,
        input.skuGroupId,
        input.primarySku ?? null,
        input.itemDescription ?? null,
        input.orderQty ?? 1,
        input.multiSkuData ? JSON.stringify(input.multiSkuData) : null,
        now,
        now,
      ],
    );

    const { rows } = await this.pool.query<PrintQueueRow>(
      `SELECT * FROM print_queue_orders WHERE order_id = $1 AND client_id = $2 LIMIT 1`,
      [input.orderId, input.clientId],
    );
    return this.mapRow(rows[0]);
  }

  async getByClient(clientId: number, status?: 'queued' | 'printed'): Promise<PrintQueueEntry[]> {
    const { rows } = status
      ? await this.pool.query<PrintQueueRow>(
          `SELECT * FROM print_queue_orders WHERE client_id = $1 AND status = $2 ORDER BY queued_at ASC`,
          [clientId, status],
        )
      : await this.pool.query<PrintQueueRow>(
          `SELECT * FROM print_queue_orders WHERE client_id = $1 ORDER BY queued_at ASC`,
          [clientId],
        );
    return rows.map((row) => this.mapRow(row));
  }

  async findById(id: string): Promise<PrintQueueEntry | null> {
    const { rows } = await this.pool.query<PrintQueueRow>(
      `SELECT * FROM print_queue_orders WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async findByOrderId(orderId: string, clientId: number): Promise<PrintQueueEntry | null> {
    const { rows } = await this.pool.query<PrintQueueRow>(
      `SELECT * FROM print_queue_orders WHERE order_id = $1 AND client_id = $2 LIMIT 1`,
      [orderId, clientId],
    );
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async markPrinted(ids: string[], printedAt: number): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map((_, index) => `$${index + 2}`).join(',');
    await this.pool.query(
      `UPDATE print_queue_orders
       SET status = 'printed', print_count = print_count + 1, last_printed_at = $1
       WHERE id IN (${placeholders})`,
      [printedAt, ...ids],
    );
  }

  async remove(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM print_queue_orders WHERE id = $1`, [id]);
  }

  async clearByClient(clientId: number): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM print_queue_orders WHERE client_id = $1 AND status = 'queued'`,
      [clientId],
    );
    return result.rowCount ?? 0;
  }

  private mapRow(row: PrintQueueRow): PrintQueueEntry {
    return {
      id: row.id,
      clientId: Number(row.client_id),
      orderId: row.order_id,
      orderNumber: row.order_number,
      labelUrl: row.label_url,
      skuGroupId: row.sku_group_id,
      primarySku: row.primary_sku,
      itemDescription: row.item_description,
      orderQty: Number(row.order_qty),
      multiSkuData: row.multi_sku_data ? JSON.parse(row.multi_sku_data) as MultiSkuItem[] : null,
      status: row.status as 'queued' | 'printed',
      printCount: Number(row.print_count),
      lastPrintedAt: row.last_printed_at == null ? null : Number(row.last_printed_at),
      queuedAt: Number(row.queued_at),
      createdAt: Number(row.created_at),
    };
  }
}
