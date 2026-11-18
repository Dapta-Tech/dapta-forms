/**
 * The Connections page's server actions, for qa/component. The real module is
 * `'use server'` and reaches the API; a layout spec never submits, so each
 * action only has to exist.
 */
const never = async (): Promise<never> => {
  throw new Error('server actions are not available in qa/component');
};
export const connectIntegrationAction = never;
export const connectSalesforceAction = never;
export const connectGoHighLevelAction = never;
export const disconnectIntegrationAction = never;
export const startGoogleSheetsAuthAction = never;
