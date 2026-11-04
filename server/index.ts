import "./env.js";
import { createApp } from "./app.js";
import { HAS_KEY, MODEL_ID } from "./llm.js";

const port = Number(process.env.PORT) || 3210;
createApp().listen(port, "0.0.0.0", () => {
  console.log(`Persona Cart Lab on http://localhost:${port} (${HAS_KEY ? `live, ${MODEL_ID}` : "simulation mode: set MODEL_API_KEY for Muse Spark"})`);
});
