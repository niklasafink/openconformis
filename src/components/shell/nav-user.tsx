"use client";

import { Check, ChevronsUpDown, LogIn, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Link, usePathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { authClient } from "@/lib/auth-client";

export type NavUserLabels = Readonly<{
  account: string;
  anonymous: string;
  anonymousHint: string;
  signIn: string;
  signOut: string;
  language: string;
  german: string;
  english: string;
}>;

type NavUserProps = Readonly<{
  locale: AppLocale;
  labels: NavUserLabels;
  user: { name: string; email: string } | null;
}>;

function initialOf(name: string, fallback: string) {
  const trimmed = name.trim();
  return (trimmed ? trimmed[0] : fallback[0])?.toUpperCase() ?? "?";
}

function displayName(user: { name: string; email: string }) {
  if (user.name.trim()) return user.name.trim();
  return user.email.split("@")[0] ?? user.email;
}

export function NavUser({ locale, labels, user }: NavUserProps) {
  const { isMobile } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      try {
        await authClient.signOut();
      } finally {
        router.push(`/${locale}/analyses/new/framework`);
        router.refresh();
      }
    });
  }

  const primaryLine = user ? displayName(user) : labels.anonymous;
  const secondaryLine = user ? user.email : labels.anonymousHint;
  const initial = user ? initialOf(user.name, user.email) : "?";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label={labels.account}
              className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-full">
                <AvatarFallback className="rounded-full bg-primary font-serif text-sm text-primary-foreground">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{primaryLine}</span>
                <span className="truncate text-xs text-muted-foreground">{secondaryLine}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {labels.language}
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link
                  href={pathname}
                  locale="de"
                  aria-current={locale === "de" ? "true" : undefined}
                >
                  <span aria-hidden="true">🇩🇪</span>
                  <span className="flex-1">{labels.german}</span>
                  {locale === "de" ? <Check aria-hidden="true" /> : null}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  href={pathname}
                  locale="en"
                  aria-current={locale === "en" ? "true" : undefined}
                >
                  <span aria-hidden="true">🇺🇸</span>
                  <span className="flex-1">{labels.english}</span>
                  {locale === "en" ? <Check aria-hidden="true" /> : null}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {user ? (
              <DropdownMenuItem onSelect={signOut} disabled={pending}>
                <LogOut />
                {labels.signOut}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem asChild>
                <Link href="/sign-in" locale={locale}>
                  <LogIn />
                  {labels.signIn}
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
