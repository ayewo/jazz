import { clsx } from "clsx";
import { SideNavHeader } from "@/components/SideNavHeader";
import { SideNavItem } from "@/components/SideNavItem";
import React from "react";

interface SideNavItem {
    name: string;
    href?: string;
    done?: number;
    items?: SideNavItem[];
}
export function SideNav({
    items,
    children,
    className,
}: {
    items: SideNavItem[];
    className?: string;
    children?: React.ReactNode;
}) {
    return (
        <div className={clsx(className, "text-sm space-y-5")}>
            <div className="flex items-center gap-2">
                <span className="inline-block size-2 rounded-full bg-yellow-400"></span>{" "}
                Documentation coming soon
            </div>

            {items.map(({ name, href, items }) => (
                <div key={name}>
                    <SideNavHeader href={href}>{name}</SideNavHeader>
                    {items &&
                        items.map(({ name, href, items, done }) => (
                            <ul key={name}>
                                <li>
                                    <SideNavItem
                                        href={
                                            done === 0
                                                ? "/docs/coming-soon"
                                                : href
                                        }
                                    >
                                        {done == 0 && (
                                            <span className="mr-1.5 inline-block size-2 rounded-full bg-yellow-400"></span>
                                        )}

                                        <span
                                            className={
                                                done === 0
                                                    ? "text-stone-400 dark:text-stone-600"
                                                    : ""
                                            }
                                        >
                                            {name}
                                        </span>
                                    </SideNavItem>
                                </li>

                                {items && items?.length > 0 && (
                                    <ul className="pl-4">
                                        {items.map(({ name, href }) => (
                                            <li key={href}>
                                                <SideNavItem href={href}>
                                                    {name}
                                                </SideNavItem>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </ul>
                        ))}
                </div>
            ))}

            {children}
        </div>
    );
}