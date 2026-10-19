// The app's icon set: Phosphor (https://phosphoricons.com), one consistent family.
// This file is the only place that names glyphs — pages import IconX names from here,
// so swapping a symbol is a one-line change. Rules (DESIGN.md § Icons):
//  - weight "regular" everywhere; "fill" only for a selected tab / active state
//  - size with width/height (or `size`) to match the adjacent text: 14 in sm buttons,
//    16 in rows and default buttons, 20 in the tab bar
//  - no text glyphs (⭐ ✓ ▶ ⚑) standing in for icons
// The `/ssr` build needs no React context, so these work in server and client components.
export {
  House as IconToday,
  CalendarBlank as IconCalendar,
  UsersThree as IconUsers,
  IdentificationBadge as IconTeam,
  Repeat as IconRepeat,
  Wallet as IconDollar,
  GearSix as IconSettings,
  Plus as IconPlus,
  MagnifyingGlass as IconSearch,
  Phone as IconPhone,
  ChatCircleText as IconMessage,
  MapPin as IconPin,
  EnvelopeSimple as IconMail,
  Check as IconCheck,
  X as IconX,
  CaretLeft as IconChevronLeft,
  CaretRight as IconChevronRight,
  DotsThreeCircle as IconMore,
  Car as IconCar,
  Boat as IconBoat,
  Prohibit as IconBlock,
  UploadSimple as IconUpload,
  DownloadSimple as IconDownload,
  Sparkle as IconSparkle,
  SignOut as IconLogout,
  Star as IconStar,
  Flag as IconFlag,
  Play as IconPlay,
  Trash as IconTrash,
  CaretUpDown as IconCaretUpDown,
  Eye as IconEye,
} from "@phosphor-icons/react/ssr";
export type { Icon as IconComponent } from "@phosphor-icons/react";
