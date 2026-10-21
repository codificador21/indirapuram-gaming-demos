'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChartIcon, HomeIcon, InboxIcon, ListIcon, PlusIcon } from './icons';

const ITEMS = [
  { href: '/', label: 'Home', Icon: HomeIcon },
  { href: '/transactions', label: 'Activity', Icon: ListIcon },
  { href: '/add', label: 'Add', Icon: PlusIcon, primary: true },
  { href: '/insights', label: 'Insights', Icon: ChartIcon },
  { href: '/review', label: 'Review', Icon: InboxIcon },
] as const;

export function BottomNav({ reviewCount }: { reviewCount: number }) {
  const path = usePathname();
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-page/90 backdrop-blur-xl">
      <ul className="mx-auto grid max-w-md grid-cols-5 px-2 pt-1.5 pb-1">
        {ITEMS.map(({ href, label, Icon, ...rest }) => {
          const active = href === '/' ? path === '/' : path.startsWith(href);
          if ('primary' in rest) {
            return (
              <li key={href} className="flex justify-center">
                <Link
                  href={href}
                  aria-label="Add transaction"
                  className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-on-accent shadow-lg shadow-black/30 ring-4 ring-page transition active:scale-95"
                >
                  <Icon size={26} strokeWidth={2.4} />
                </Link>
              </li>
            );
          }
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition ${active ? 'text-accent-ink' : 'text-muted'}`}
              >
                <Icon size={22} strokeWidth={active ? 2.3 : 1.9} />
                {label}
                {href === '/review' && reviewCount > 0 && (
                  <span className="absolute top-0.5 right-[calc(50%-18px)] min-w-[18px] rounded-full bg-critical px-1 text-center text-[10px] leading-[18px] font-semibold text-white">
                    {reviewCount > 99 ? '99+' : reviewCount}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
