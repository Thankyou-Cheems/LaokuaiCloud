export function LogoIcon({ size = 48 }: { size?: number; beta?: boolean }) {
  return <img width={size} height={size} src="/laokuai-icon.png" alt="" />;
}

export function Logo() {
  return <div className="flex justify-center items-center gap-3">
    <h2 className="text-4xl">唠蒯</h2>
    <LogoIcon />
  </div>;
}
