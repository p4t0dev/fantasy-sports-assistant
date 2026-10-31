"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** Next leaves the scroll position alone while the new page's top is in view,
 *  and with a tall sticky header it often is: a tab opened with the headline
 *  under the header, and the offset carried on from page to page. Going back
 *  is the exception, there the browser restores where the reader was. */
export default function ScrollToTop() {
  const pathname = usePathname();
  const wentBack = useRef(false);

  useEffect(() => {
    const onPopState = () => {
      wentBack.current = true;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!wentBack.current) window.scrollTo(0, 0);
    wentBack.current = false;
  }, [pathname]);

  return null;
}
