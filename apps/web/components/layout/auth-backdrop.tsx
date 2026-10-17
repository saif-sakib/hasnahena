/**
 * The ground behind the sign-in screens: the public site's ivory paper and
 * khatam lattice, so signing in looks like the same organisation. Pure CSS —
 * no image request. The parent must be `relative`; content above it needs its
 * own `relative z-10`.
 */
export function AuthBackdrop() {
  return (
    <div aria-hidden="true" className="surface-paper pointer-events-none absolute inset-0 overflow-hidden">
      <div className="lattice-tile absolute inset-0 [mask-image:radial-gradient(90%_70%_at_50%_0%,black,transparent_78%)]" />
      <div className="absolute -top-32 -right-32 h-[30rem] w-[30rem] rounded-full bg-emerald-200/35 blur-3xl dark:bg-emerald-900/25" />
      <div className="absolute -bottom-32 -left-32 h-[30rem] w-[30rem] rounded-full bg-teal-200/30 blur-3xl dark:bg-teal-900/20" />
    </div>
  );
}
