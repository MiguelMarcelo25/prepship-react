import type { GenerateManifestInput } from "../../../../../../../packages/contracts/src/manifests/contracts.ts";
import type { PgPool } from "../../../../../../../packages/shared/src/postgres/database.ts";
import type { ManifestRepository } from "../application/manifest-repository.ts";
import type { ManifestShipmentRecord } from "../domain/manifest.ts";

export class PgManifestRepository implements ManifestRepository {
  private readonly pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async listShipments(input: GenerateManifestInput): Promise<ManifestShipmentRecord[]> {
    const clauses = ["s.shipdate >= $1", "s.shipdate <= $2"];
    const params: Array<string | number> = [input.startDate, input.endDate];
    let idx = 3;

    if (input.carrierId) {
      clauses.push(`s.source = $${idx++}`);
      params.push(input.carrierId);
    }
    if (input.clientId != null) {
      clauses.push(`s.clientid = $${idx++}`);
      params.push(input.clientId);
    }

    const sql = `
      SELECT
        s.shipmentid, o.ordernumber, s.trackingnumber, s.carriercode, s.servicecode,
        s.shipmentcost, s.othercost, s.shipdate,
        COALESCE(s.weight_oz, o.weightvalue, 0) AS weightoz,
        CASE WHEN s.shipmentid IS NOT NULL THEN 'Shipped' ELSE 'Pending' END AS status
      FROM shipments s
      JOIN orders o ON o.orderid = s.orderid
      WHERE ${clauses.join(" AND ")}
      ORDER BY s.shipdate DESC, s.shipmentid DESC
    `;

    const { rows } = await this.pool.query<Record<string, unknown>>(sql, params);
    return rows.map((row) => ({
      shipmentId: Number(row.shipmentid),
      orderNumber: row.ordernumber == null ? null : String(row.ordernumber),
      trackingNumber: row.trackingnumber == null ? null : String(row.trackingnumber),
      carrierCode: row.carriercode == null ? null : String(row.carriercode),
      serviceCode: row.servicecode == null ? null : String(row.servicecode),
      shipmentCost: row.shipmentcost == null ? null : Number(row.shipmentcost),
      otherCost: row.othercost == null ? null : Number(row.othercost),
      shipDate: row.shipdate == null ? null : String(row.shipdate),
      weightOz: row.weightoz == null ? null : Number(row.weightoz),
      status: String(row.status ?? "Pending"),
    }));
  }
}
