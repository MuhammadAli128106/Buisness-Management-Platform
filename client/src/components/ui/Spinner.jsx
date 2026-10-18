/** <Spinner size="sm|md|lg" label="Loading" /> */
export default function Spinner({ size = 'md', label = 'Loading' }) {
  const s = { sm: 'h-4 w-4 border-2', md: 'h-6 w-6 border-2', lg: 'h-10 w-10 border-4' }[size] || 'h-6 w-6 border-2';
  return (
    <span role="status" className="inline-flex items-center">
      <span className={`${s} animate-spin rounded-full border-current border-t-transparent opacity-70`} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
