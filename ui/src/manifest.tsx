/**
 * Entry point of the extension. The engine loads this module (exposed as `./manifest` in
 * rsbuild.config.ts) and reads the exported `manifest` at the bottom of this file to wire in
 * sidebars, pages and injects.
 * Import engine APIs only from `@graphite-sports/sdk`; the engine provides it at runtime.
 */
import { useQuery } from '@tanstack/react-query';
import {
  AppButton,
  buildRoute,
  extensionContribution,
  extensionRouteBuilder,
  getClassesByEventQO,
  toast,
  useRouter,
  type ExtensionManifest,
  type ExtensionPageContribution,
  type ExtensionSidebarProps,
  type GamePageContribution,
} from '@graphite-sports/sdk';
import { useLL } from './i18n/useLL';

// Extension pages live below `/ext/` of an event. Path parameters are passed to the component as props.
const pagePath = '/workspace/:workspaceId/event/:eventId/ext/starter';

const page: ExtensionPageContribution<typeof pagePath> = { path: pagePath, PageComponent: StarterPage };

// Typesafe links to this extension's own pages.
const buildExtensionRoute = extensionRouteBuilder(page);

function StarterSidebar({ workspaceId, eventId }: ExtensionSidebarProps) {
  const LL = useLL();
  const { navigate } = useRouter();
  // The engine's query options read engine data through the engine's own query client.
  const { data: classes } = useQuery(getClassesByEventQO(workspaceId, eventId));
  return (
    <div className="flex flex-col gap-2 p-2">
      <AppButton href={buildExtensionRoute(pagePath, { workspaceId, eventId })}>{LL.OpenPage()}</AppButton>
      <h2>{LL.ClassesOfEvent()}</h2>
      {classes?.map(({ class: clazz }) => (
        <button
          key={clazz.id}
          className="text-left hover:underline"
          onClick={() =>
            navigate(
              buildRoute('/workspace/:workspaceId/event/:eventId/class/:classId', { workspaceId, eventId, classId: clazz.id }),
            )
          }
        >
          {clazz.name}
        </button>
      ))}
    </div>
  );
}

function StarterPage() {
  const LL = useLL();
  return (
    <div className="flex flex-col items-start gap-2 p-4">
      <h1>{LL.PageTitle()}</h1>
      <AppButton type="primary" onClick={() => toast(LL.Hello())}>
        {LL.SayHello()}
      </AppButton>
    </div>
  );
}

// Injects render inside existing engine views; `game-page` receives the game that is shown.
const GameNote: GamePageContribution = ({ game }) => {
  const LL = useLL();
  return <p>{LL.GameNote({ name: game.name })}</p>;
};

export const manifest: ExtensionManifest = {
  // Stable and unique among all extensions.
  id: 'starter-extension',
  sidebars: [{ id: 'starter', name: { en: 'Starter', de: 'Starter' }, icon: 'S', SidebarComponent: StarterSidebar }],
  pages: [page],
  injects: [extensionContribution({ id: 'game-note', type: 'game-page', contribution: GameNote })],
};
