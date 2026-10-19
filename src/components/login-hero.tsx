"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";

export function LoginHero() {
  const { locale } = useLocale();
  const french = locale === "fr";
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showCopy, setShowCopy] = useState(false);
  const [showVideo, setShowVideo] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.pause();
      setShowVideo(false);
      setShowCopy(true);
      return;
    }

    const fallbackTimer = window.setTimeout(() => {
      setShowVideo(false);
      setShowCopy(true);
    }, 3000);
    video.play().catch(() => {
      window.clearTimeout(fallbackTimer);
      setShowVideo(false);
      setShowCopy(true);
    });
    return () => window.clearTimeout(fallbackTimer);
  }, []);

  const showFallback = () => {
    setShowVideo(false);
    setShowCopy(true);
  };

  return (
    <section className="auth-brand-panel relative isolate hidden h-full overflow-hidden bg-[#063f35] px-[min(5vw,78px)] pt-[15vh] text-white lg:flex lg:flex-col">
      {showVideo && (
        <video
          ref={videoRef}
          className="auth-brand-video absolute inset-0 h-full w-full object-cover object-center"
          autoPlay
          muted
          playsInline
          preload="auto"
          poster="/images/login-fleet-intro-poster.jpg"
          onEnded={() => setShowCopy(true)}
          onError={showFallback}
          aria-hidden="true"
        >
          <source src="/videos/login-fleet-intro.mp4" type="video/mp4" />
        </video>
      )}
      <div className="login-hero-copy relative z-10" data-visible={showCopy}>
        <h2 className="max-w-[590px] text-[clamp(2.4rem,3.1vw,3.2rem)] leading-[1.13] font-semibold tracking-[-0.055em]">
          {french ? "Une vision claire de votre flotte" : "A clear view of your fleet"}
        </h2>
        <p className="mt-5 max-w-[570px] text-[clamp(1rem,1.25vw,1.2rem)] leading-relaxed text-[#d1e2df]">
          {french ? "Véhicules, conducteurs et affectations dans un espace sécurisé." : "Vehicles, drivers and assignments in one secure workspace."}
        </p>
      </div>
    </section>
  );
}
