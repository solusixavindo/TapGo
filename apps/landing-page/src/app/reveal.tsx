"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Bungkus elemen agar muncul dengan animasi fade+slide saat tergulir ke
 * pandangan. Tanpa JavaScript (html tanpa class "js"), CSS di globals.css
 * membuat konten langsung terlihat penuh — animasi murni progresif, tidak
 * pernah menyembunyikan konten secara permanen.
 */
export function Reveal({
  children,
  className = "",
  delayMs = 0
}: {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal-init ${visible ? "revealed" : ""} ${className}`}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  );
}
