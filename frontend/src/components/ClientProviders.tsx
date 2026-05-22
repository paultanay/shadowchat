"use client";

import dynamic from "next/dynamic";

const ToastContainer = dynamic(() => import("@/components/ToastContainer"), {
  ssr: false,
});

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ToastContainer />
    </>
  );
}
