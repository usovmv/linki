import { ReactNode, useCallback } from "react";
import { useRouter } from "next/router";
import Sidebar from "./Sidebar";

const NO_LAYOUT_PATHS = ["/login"];
const FULL_HEIGHT_PATHS = ["/agent"];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const handleCollapse = useCallback((_c: boolean) => {}, []);

  if (NO_LAYOUT_PATHS.includes(router.pathname)) {
    return <>{children}</>;
  }

  const isFullHeight = FULL_HEIGHT_PATHS.some((p) => router.pathname.startsWith(p));
  const ml = "ml-13";

  return (
    <div className="h-screen overflow-hidden bg-base-100 flex">
      <Sidebar onCollapse={handleCollapse} />
      {isFullHeight ? (
        <main className={`${ml} flex-1 overflow-hidden transition-[margin] duration-200`}>{children}</main>
      ) : (
        <main className={`${ml} flex-1 p-6 overflow-y-auto transition-[margin] duration-200`}>{children}</main>
      )}
    </div>
  );
}
