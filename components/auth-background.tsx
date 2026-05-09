export function AuthBackground() {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 bg-[#070706]" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_64%_48%,rgba(38,36,31,0.42)_0%,rgba(17,16,14,0.52)_34%,rgba(7,7,6,0)_62%),linear-gradient(112deg,#050504_0%,#0c0b0a_32%,#10100e_54%,#090908_78%,#070706_100%)]" />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.18] mix-blend-soft-light"
        style={{
          backgroundImage: "url('/auth-noise.png')",
          backgroundSize: '320px 320px',
        }}
      />
    </>
  );
}
