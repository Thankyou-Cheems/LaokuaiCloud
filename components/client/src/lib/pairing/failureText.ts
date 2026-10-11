/** Only formats known app failures for display; original diagnostics stay untouched. */
export function pairingFailureText(message: string, translate: (key: string) => string): string {
  const keys = new Map([
    ["Couldn't read which account this device is signed in to.", "shellThird.pairingAccount"],
    ["Couldn't put together what to send.", "shellThird.pairingEnvelope"],
  ]);
  const key = keys.get(message);
  return key ? translate(key) : message;
}
