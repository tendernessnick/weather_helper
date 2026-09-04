/** Lucide icon set + custom tennis ball, behind our stable name API.
 *  Usage: <Icon name="pin" className="w-4 h-4" /> */
import type { ComponentType, SVGProps } from 'react';
import { BarChart3, Bell, ChevronRight, Clock, CloudDrizzle, CloudLightning,
         CloudRain, Droplets, Gauge, MapPin, Phone, Search, Sun, Timer,
         TriangleAlert, Users } from 'lucide-react';

type IconProps = { className?: string; strokeWidth?: number };

/** Tennis ball: circle with two inward seam arcs. Lucide's "Volleyball" reads
 *  as a volleyball (wavy panels), so we draw the real thing ourselves. */
function TennisBall({ className, strokeWidth = 1.8 }: IconProps) {
  const p: SVGProps<SVGSVGElement> = {
    fill: 'none', stroke: 'currentColor', strokeWidth,
    strokeLinecap: 'round',
  };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...p}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M5.55 6.1c3.15 2.4 3.15 9.4 0 11.8" />
      <path d="M18.45 6.1c-3.15 2.4-3.15 9.4 0 11.8" />
    </svg>
  );
}

const ICONS: Record<string, ComponentType<IconProps>> = {
  ball: TennisBall,
  pin: MapPin,
  clock: Clock,
  phone: Phone,
  warn: TriangleAlert,
  rain: CloudRain,
  sun: Sun,
  drizzle: CloudDrizzle,
  storm: CloudLightning,
  gauge: Gauge,
  bell: Bell,
  chevron: ChevronRight,
  search: Search,
  drop: Droplets,
  chart: BarChart3,
  people: Users,
  clockbolt: Timer,
};

export type IconName = keyof typeof ICONS;

export default function Icon({
  name, className = 'w-4 h-4', strokeWidth = 1.8,
}: { name: IconName; className?: string; strokeWidth?: number }) {
  const Cmp = ICONS[name];
  return <Cmp className={className} strokeWidth={strokeWidth} />;
}
