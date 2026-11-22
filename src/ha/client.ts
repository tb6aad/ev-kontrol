import {
  Connection,
  HassEntities,
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  callService,
  ERR_INVALID_AUTH,
  ERR_CANNOT_CONNECT,
} from "home-assistant-js-websocket";

export interface AreaEntry {
  area_id: string;
  name: string;
}
export interface DeviceEntry {
  id: string;
  area_id: string | null;
  name: string | null;
  name_by_user: string | null;
  model?: string | null;
  manufacturer?: string | null;
}
export interface EntityEntry {
  entity_id: string;
  area_id: string | null;
  device_id: string | null;
  hidden_by: string | null;
  disabled_by: string | null;
  entity_category: string | null;
}

export interface Registries {
  areas: AreaEntry[];
  devices: DeviceEntry[];
  entities: EntityEntry[];
}

/** Tek deneme yapar; yeniden deneme App.tsx'teki döngüdedir (deneme sayısını ekranda göstermek için). */
export async function connect(url: string, token: string): Promise<Connection> {
  const auth = createLongLivedTokenAuth(url.replace(/\/+$/, ""), token);
  try {
    return await createConnection({ auth });
  } catch (err) {
    if (err === ERR_INVALID_AUTH) throw new Error("Token geçersiz.");
    if (err === ERR_CANNOT_CONNECT) throw new Error("Home Assistant'a ulaşılamadı. Adresi kontrol et.");
    throw new Error(`Bağlantı hatası (${String(err)})`);
  }
}

export async function fetchRegistries(conn: Connection): Promise<Registries> {
  const [areas, devices, entities] = await Promise.all([
    conn.sendMessagePromise<AreaEntry[]>({ type: "config/area_registry/list" }),
    conn.sendMessagePromise<DeviceEntry[]>({ type: "config/device_registry/list" }),
    conn.sendMessagePromise<EntityEntry[]>({ type: "config/entity_registry/list" }),
  ]);
  return { areas, devices, entities };
}

export function watchEntities(conn: Connection, cb: (e: HassEntities) => void) {
  return subscribeEntities(conn, cb);
}

export function toggle(conn: Connection, entityId: string, state?: string) {
  const domain = entityId.split(".")[0];
  if (domain === "vacuum") {
    return callService(conn, domain, state === "cleaning" ? "return_to_base" : "start", { entity_id: entityId });
  }
  return callService(conn, domain, "toggle", { entity_id: entityId });
}

export function lockAction(conn: Connection, entityId: string, locked: boolean) {
  return callService(conn, "lock", locked ? "unlock" : "lock", { entity_id: entityId });
}

export function pressButton(conn: Connection, entityId: string) {
  const domain = entityId.split(".")[0]; // button | input_button | script | scene
  const service = domain === "script" || domain === "scene" ? "turn_on" : "press";
  return callService(conn, domain, service, { entity_id: entityId });
}
