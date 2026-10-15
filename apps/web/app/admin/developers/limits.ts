/**
 * The spec's bound on an API key's name (1 to 60 characters), shared by the
 * dialog's input and the server action. Its own module because a "use server"
 * file may export async functions only.
 */
export const API_KEY_NAME_MAX = 60;
