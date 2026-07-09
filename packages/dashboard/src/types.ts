export type DashboardResource = {
  kind: "gateway" | "service" | "web";
  name: string;
  mount?: string;
  binding?: string;
  workerName?: string;
  url?: string;
  devUrl?: string;
};

export type DashboardState = {
  app: string;
  gatewayUrl: string;
  resources: DashboardResource[];
  health: HealthReport | null;
};

export type HealthReport = {
  ok: boolean;
  gateway?: { name: string; version: string };
  services?: {
    name: string;
    mount: string;
    ok: boolean;
    status?: number;
    error?: string;
  }[];
  error?: string;
};

export type InspectorEvent = {
  ts: number;
  requestId: string;
  method: string;
  path: string;
  matchedService?: string;
  status: number;
  durationMs: number;
  authenticated?: boolean;
  subject?: string;
  scopes?: string[];
  error?: string;
};

export type LogEvent = {
  ts: number;
  resource: string;
  stream: "stdout" | "stderr";
  line: string;
};
