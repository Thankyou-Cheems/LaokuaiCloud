import packageMetadata from "../../package.json";

/** The renderer follows the same package marker as the native application. */
export const IS_LAOKUAI = packageMetadata.grytLaokuai === true;
