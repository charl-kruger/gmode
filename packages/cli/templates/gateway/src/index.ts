import {
  cors,
  createGateway,
  jsonErrors,
  requestId,
  requestLogger,
} from "@gmode/gateway";
import { registerServices, type GmodeEnv } from "./gmode.generated";

type Env = GmodeEnv;

const gateway = createGateway<Env>({
  name: "__APP_NAME__",
  version: "0.1.0",
});

gateway.use(requestId());
gateway.use(jsonErrors());
gateway.use(requestLogger());
gateway.use(cors());

// Services and web apps come from gmode.jsonc — run `gmode sync` after edits.
registerServices(gateway);

export default gateway;
