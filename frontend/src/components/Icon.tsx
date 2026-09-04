/** Lucide icon set behind our stable name API. Usage: <Icon name="pin" className="w-4 h-4" /> */
import type { LucideIcon } from 'lucide-react';
import { BarChart3, Bell, ChevronRight, Clock, CloudDrizzle, CloudLightning,
         CloudRain, Droplets, Gauge, MapPin, Phone, Search, Sun, Timer,
         TriangleAlert, Users, Volleyball } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  ball: Volleyball,
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
  return <Cmp className={className} strokeWidth={strokeWidth} aria-hidden />;
}
