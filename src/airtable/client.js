import Airtable from "airtable";
import { CONFIG, assertConfig } from "../config.js";

assertConfig();

export const base = new Airtable({ apiKey: CONFIG.airtableApiKey }).base(CONFIG.airtableBaseId);
