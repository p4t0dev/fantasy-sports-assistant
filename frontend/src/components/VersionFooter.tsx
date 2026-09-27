const REPO = "https://github.com/p4t0dev/fantasy-sports-assistant";

/** Version, the pull request it came from, and the exact commit.
 *
 *  The version is 0.<PR>.<patch>: the minor number is the PR that shipped
 *  this build, so a screenshot says which change it shows (CHANGELOG.md). */
export default function VersionFooter() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const sha = process.env.NEXT_PUBLIC_GIT_SHA ?? "unbekannt";
  const built = process.env.NEXT_PUBLIC_BUILD_TIME;
  const pr = version.split(".")[1];
  const date = built
    ? new Date(built).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
    : null;

  return (
    <footer className="border-t border-gray-800/80 mt-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        <span className="font-medium text-gray-400">v{version}</span>
        {pr && pr !== "0" && (
          <a href={`${REPO}/pull/${pr}`} className="hover:text-gray-300" target="_blank" rel="noreferrer">
            PR #{pr}
          </a>
        )}
        <a href={`${REPO}/commit/${sha}`} className="font-mono hover:text-gray-300" target="_blank" rel="noreferrer">
          {sha}
        </a>
        {date && <span>gebaut {date}</span>}
      </div>
    </footer>
  );
}
