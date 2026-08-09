import * as dotenv from "dotenv";
import { resolve } from "node:path";

// The seed command is commonly launched from the repository root, while its
// configuration belongs to the backend workspace. This module must be imported
// before Firebase and Google Maps, which read environment variables at import
// time.
dotenv.config({ path: resolve(__dirname, "../.env") });
