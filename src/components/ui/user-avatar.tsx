"use client";

import { useState } from "react";

interface UserAvatarProps {
    name: string;
    src?: string | null;
    size?: "sm" | "md" | "lg";
    gradient?: string;
    className?: string;
    rounded?: "xl" | "full";
}

const SIZES = {
    sm: "w-6 h-6 text-[10px]",
    md: "w-10 h-10 text-sm",
    lg: "w-14 h-14 text-lg",
};

export default function UserAvatar({ name, src, size = "md", gradient = "from-slate-500 to-slate-400", className = "", rounded = "xl" }: UserAvatarProps) {
    const [failed, setFailed] = useState(false);
    const initials = name?.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
    const sizeClass = SIZES[size];
    const roundedClass = `rounded-${rounded}`;

    if (src && !failed) {
        return (
            <img
                src={src}
                alt={name}
                // Lazy + async decode: avatars render dozens-per-page in people /
                // home / team lists; eager loading fired all of them at once.
                loading="lazy"
                decoding="async"
                className={`${sizeClass} ${roundedClass} object-cover ${className}`}
                onError={() => setFailed(true)}
                referrerPolicy="no-referrer"
            />
        );
    }

    return (
        <div className={`${sizeClass} ${roundedClass} bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold ${className}`}>
            {initials}
        </div>
    );
}
