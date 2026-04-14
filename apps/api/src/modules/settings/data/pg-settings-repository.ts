import type { AllowedSettingKey } from "../../../../../../packages/contracts/src/settings/contracts.ts";
import type { PgPool } from "../../../../../../packages/shared/src/postgres/database.ts";
import type { SettingsRepository } from "../application/settings-repository.ts";

export class PgSettingsRepository implements SettingsRepository {
  private readonly pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async get(key: AllowedSettingKey): Promise<string | null> {
    const { rows } = await this.pool.query(
      "SELECT value FROM sync_meta WHERE key = $1",
      [`setting:${key}`],
    );
    return rows.length > 0 ? (rows[0].value as string) : null;
  }

  async set(key: AllowedSettingKey, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO sync_meta (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [`setting:${key}`, value],
    );
  }
}
