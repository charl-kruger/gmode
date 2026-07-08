import { ServiceImpl } from "./service";
import type { Service, ServiceOptions } from "./types";

export function createService<Env = unknown>(
  options: ServiceOptions<Env>,
): Service<Env> {
  return new ServiceImpl<Env>(options);
}
