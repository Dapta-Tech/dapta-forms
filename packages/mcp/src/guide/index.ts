/**
 * `@quill/mcp/guide`: what teaches a model to write a dForms config. Shared by
 * the MCP server (`get_form_guide`) and the web app's API skill zip, so the two
 * can never teach different rules. No MCP SDK import here: the web app pulls
 * this entry point without the server.
 */
export {
  EDITOR_DEFAULT_FIELDS,
  FIELD_DESCRIPTIONS,
  KEPT_AS_READ_FIELDS,
  UNSUPPORTED_CONFIG_FIELDS,
  formConfigJsonSchema,
} from './config-schema';
export { EXAMPLE_CONFIGS, LEAD_CONFIG, LEAD_CONFIG_EDITED, QUIZ_CONFIG, SCORE_GATE_CONFIG } from './examples';
export {
  GUIDE_EXAMPLES,
  GUIDE_LIFECYCLE,
  GUIDE_LOGIC,
  GUIDE_PARTS,
  GUIDE_RULES,
  GUIDE_STEP_TYPES,
  formGuide,
  type FormGuide,
  type GuidePart,
} from './guide';
