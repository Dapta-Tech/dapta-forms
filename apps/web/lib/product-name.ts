/**
 * What this build calls the product, and whether it is Dapta's own build.
 *
 * The name comes from the deployment (`NEXT_PUBLIC_PRODUCT_NAME`, inlined at
 * build time): a bare fork keeps the default `Forms` or names itself, and gets a
 * neutral typographic brand. Dapta's pipeline sets it to name the real product,
 * and only then may Dapta's artwork render (see `components/brand/brand.tsx`).
 *
 * The product is called dForms. Dapta's pipeline passed `Dapta Forms` before the
 * rename and lives in a repository this one does not control, so BOTH spellings
 * identify a Dapta build and both display as `dForms`. Without that, deploying
 * this change ahead of the pipeline's would silently turn Dapta's own build into
 * a fork: the marks would vanish and the badge would fall back to a letter chip.
 * Once the pipeline passes `dForms`, the legacy spelling is dead weight and can go.
 */
const RAW_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Forms';

/** True only on a build that identifies itself as Dapta's own. */
export const IS_DAPTA_BRAND = RAW_NAME === 'dForms' || RAW_NAME === 'Dapta Forms';

/** The customer-facing product name. `dForms` on a Dapta build, whatever the fork chose otherwise. */
export const PRODUCT_NAME = IS_DAPTA_BRAND ? 'dForms' : RAW_NAME;
