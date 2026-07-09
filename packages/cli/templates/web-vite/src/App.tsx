import { useEffect, useState } from "react";

export function App() {
  const [message, setMessage] = useState("...");

  useEffect(() => {
    fetch("__MOUNT__/api/hello")
      .then((res) => res.json() as Promise<{ message: string }>)
      .then((body) => setMessage(body.message))
      .catch(() => setMessage("API unavailable"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", padding: "4rem" }}>
      <h1>__NAME__</h1>
      <p>Served through the GMode gateway at <code>__MOUNT__</code>.</p>
      <p>
        API says: <strong>{message}</strong>
      </p>
    </main>
  );
}
