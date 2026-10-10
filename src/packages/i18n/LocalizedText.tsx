import { useTranslation } from "react-i18next";

/** A message kept reactive when rendered by a long-lived toast or portal. */
export function LocalizedText({ translationKey, values }: {
  translationKey: string;
  values?: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  return <>{t(translationKey, values)}</>;
}
