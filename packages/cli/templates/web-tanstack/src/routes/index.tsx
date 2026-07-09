import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

const getHello = createServerFn().handler(async () => {
  // Server functions run in the Worker; call the embedded API in-process.
  return { message: "Hello from __NAME__ (SSR)" };
});

export const Route = createFileRoute("/")({
  loader: () => getHello(),
  component: Home,
});

function Home() {
  const data = Route.useLoaderData();
  return (
    <main style={{ fontFamily: "system-ui", padding: "4rem" }}>
      <h1>__NAME__</h1>
      <p>
        A TanStack Start app served through the GMode gateway at{" "}
        <code>__MOUNT__</code>.
      </p>
      <p>
        Server says: <strong>{data.message}</strong>
      </p>
      <p>
        The typed API at <code>__MOUNT__/api/hello</code> appears in the
        gateway's Swagger UI automatically.
      </p>
    </main>
  );
}
