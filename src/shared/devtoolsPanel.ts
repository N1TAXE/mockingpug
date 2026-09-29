// Framework-agnostic devtools panel — the single UI implementation behind
// `<MockDevtools>` (React), `mockingpug/vue`'s panel, and any future host.
// Pure DOM, no React/Vue: mount it into any element, drive it with the same
// callback props the old React `DevtoolsPanel` took. Returns `update` (feed it
// fresh `entities`/`runtime`/controls when they change) and `dispose`.
//
// Ported 1:1 from the former React `devtoolsUI.tsx`: same layout, labels,
// aria-labels and `data-testid`s (so the existing devtools test suites are the
// acceptance net), same three views, draggable data windows, list
// virtualization, and JSON editor.
import type { OneShotOverrideEntry, RequestLogEntry, StoreSnapshot } from '../query/index.js';

// ── Tokens ────────────────────────────────────────────────────────────────
const FONT_UI = "'Nunito', system-ui, sans-serif";
const FONT_CODE = "'JetBrains Mono', ui-monospace, monospace";
const BORDER = '#E2E2E2';
const TEXT = '#23272F';
const SWITCH_ON = '#1d9e4b';
const SWITCH_OFF = '#D9D4C5';
const WINDOW_SHADOW = '0px 8px 16px rgba(0, 0, 0, 0.15)';
const LINE_HEIGHT = 'normal';

const ENTITY_ROW_HEIGHT = 49;
const ENTITY_LIST_HEIGHT = 221;
const ENTITY_LIST_OVERSCAN = 3;

type Style = Record<string, string>;

const rowLabel: Style = { fontFamily: FONT_UI, fontWeight: '600', fontSize: '14px', lineHeight: LINE_HEIGHT, color: TEXT, whiteSpace: 'nowrap' };
const faded: Style = { ...rowLabel, opacity: '0.5' };
const numberInput: Style = { width: '80px', border: 'none', outline: 'none', background: 'transparent', textAlign: 'right', fontFamily: FONT_UI, fontWeight: '600', fontSize: '14px', color: TEXT, padding: '0' };
const filterInput: Style = { width: '100%', boxSizing: 'border-box', border: `1px solid ${BORDER}`, borderRadius: '6px', padding: '6px 8px', fontFamily: FONT_UI, fontSize: '13px', fontWeight: '600', color: TEXT, outline: 'none' };
const smallButton: Style = { boxSizing: 'border-box', flex: 'none', padding: '4px 10px', fontFamily: FONT_UI, fontWeight: '600', fontSize: '12px', color: TEXT, background: '#F6F6F6', border: `1px solid ${BORDER}`, borderRadius: '6px', cursor: 'pointer' };
const unstyledButton: Style = { boxSizing: 'border-box', display: 'block', width: '100%', margin: '0', padding: '0', border: 'none', background: 'transparent', font: 'inherit', textAlign: 'left', cursor: 'pointer' };

const STYLE_TAG_ID = 'mp-devtools-style';
const STYLE_TAG_CSS = `
  .mp-icon-btn { transition: background .3s ease; }
  .mp-icon-btn .mp-fade-icon { opacity: .5; transition: opacity .3s ease; display: flex; }
  .mp-icon-btn:hover .mp-fade-icon { opacity: 1; }
  .mp-hover-item { transition: background .3s ease; }
  .mp-hover-item:hover { background: #F6F6F6; }
  .mp-number-input { appearance: none; -moz-appearance: textfield; }
  .mp-number-input::-webkit-inner-spin-button,
  .mp-number-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
`;

// ── Icons (SVG markup) ──────────────────────────────────────────────────────
const ICON_LOGO = `<svg width="18" height="14" viewBox="0 0 18 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.36302 7.77262C7.46199 6.94443 8.90679 6.94073 10.144 7.31532C11.3825 7.69032 12.552 8.48105 13.1838 9.44752C13.5033 9.9362 13.7003 10.4945 13.664 11.0781C13.6276 11.6621 13.3605 12.2183 12.8538 12.7027L12.8295 12.7257C12.6013 12.9397 12.3447 13.0937 12.0581 13.1669C11.7686 13.2408 11.4895 13.2218 11.2368 13.1496C11.111 13.1137 10.9903 13.0639 10.8751 13.0051C10.847 13.0383 10.8144 13.0691 10.7774 13.0964C10.3453 13.4153 9.68758 13.8116 8.99813 13.9494C8.64549 14.0199 8.24882 14.0298 7.86325 13.8935C7.46675 13.7533 7.14027 13.4789 6.90492 13.0801C6.89788 13.0682 6.89136 13.0561 6.88535 13.044C6.74299 13.0383 6.60245 12.9839 6.49416 12.881C6.26602 12.664 6.26739 12.3137 6.49723 12.0983C6.59461 12.0071 6.71305 11.8743 6.86638 11.6992C7.01221 11.5326 7.18328 11.3353 7.3639 11.1483C7.54412 10.9617 7.74951 10.7687 7.9732 10.6109C8.09233 10.5269 8.22689 10.4456 8.37505 10.3808C8.37505 10.3272 8.38337 10.2727 8.40082 10.2188C8.51837 9.85581 8.55962 9.4987 8.52165 9.09276C8.49318 8.78832 8.73162 8.51973 9.05422 8.49285C9.37682 8.46598 9.66145 8.691 9.68993 8.99545C9.73701 9.49893 9.69265 9.96371 9.55793 10.4264C9.72571 10.522 9.87968 10.6462 10.0138 10.766C10.1618 10.8984 10.3116 11.0492 10.4521 11.1913C10.597 11.3378 10.7345 11.4777 10.8746 11.6082C11.1691 11.8826 11.3977 12.0392 11.5766 12.0903C11.6509 12.1116 11.7043 12.1106 11.7517 12.0985C11.802 12.0857 11.8868 12.0495 12.003 11.9405L12.0343 11.9106C12.351 11.6023 12.4755 11.2974 12.4932 11.0132C12.5121 10.7101 12.4122 10.3751 12.1857 10.0287C11.7257 9.32492 10.8072 8.67851 9.7857 8.36923C8.76289 8.05954 7.7757 8.12443 7.09486 8.63752C6.42112 9.14526 5.86688 10.2287 6.03432 12.3447C6.05844 12.6495 5.81619 12.9151 5.49324 12.9378C5.17028 12.9606 4.88891 12.7319 4.86479 12.4272C4.68356 10.1368 5.25696 8.60617 6.36302 7.77262ZM8.92981 11.3621C8.87096 11.3797 8.78667 11.419 8.67523 11.4976C8.53657 11.5953 8.38817 11.7308 8.23064 11.8939C8.07992 12.0499 7.93514 12.216 7.78916 12.3828C7.84455 12.4257 7.8925 12.4789 7.92946 12.5415C8.04649 12.7398 8.16964 12.8199 8.2747 12.8571C8.39069 12.8981 8.54756 12.9081 8.75511 12.8666C9.1472 12.7883 9.58764 12.5528 9.94969 12.3C9.82493 12.1799 9.70477 12.0578 9.59469 11.9464C9.45079 11.8009 9.32494 11.6748 9.20726 11.5696C9.08698 11.4621 8.9999 11.3992 8.93954 11.3671C8.93603 11.3652 8.93278 11.3636 8.92981 11.3621ZM0.327273 2.33014C0.872249 1.27238 2.57028 -0.339519 5.20412 0.177328C5.52119 0.239549 5.7248 0.532558 5.65888 0.831791C5.59295 1.13103 5.28244 1.32318 4.96536 1.26096C3.02937 0.881057 1.78867 2.04224 1.39029 2.79835C1.38846 2.80426 1.38544 2.81443 1.38148 2.82977C1.37109 2.86999 1.35864 2.92755 1.34498 3.00311C1.31777 3.15358 1.28952 3.35461 1.26387 3.59043C1.21261 4.06179 1.17417 4.65018 1.17282 5.21351C1.17153 5.75481 1.2049 6.23686 1.27873 6.56618C1.3302 6.50293 1.38546 6.42653 1.44386 6.33619C1.64295 6.02823 1.84096 5.61923 2.03656 5.16764C2.23303 4.71402 2.41003 4.25859 2.5853 3.83359C2.74994 3.43432 2.92344 3.03456 3.09617 2.77714C3.26944 2.51894 3.63172 2.44217 3.90532 2.60569C4.17892 2.76921 4.26026 3.11111 4.08699 3.36932C3.98632 3.51935 3.85212 3.81331 3.67823 4.23499C3.51496 4.63092 3.32258 5.12369 3.12215 5.58644C2.92084 6.05123 2.69442 6.52684 2.445 6.91266C2.31997 7.10606 2.17969 7.29194 2.02199 7.44678C1.8671 7.59885 1.66789 7.74826 1.42039 7.82508C1.25292 7.87702 1.06413 7.8867 0.876227 7.82653C0.694835 7.76845 0.562388 7.66081 0.470327 7.5554C0.298723 7.35893 0.207745 7.10205 0.151756 6.88101C0.0348891 6.41964 -0.00138123 5.80508 3.99044e-05 5.21101C0.00148644 4.60657 0.0424395 3.98109 0.0972111 3.47744C0.124582 3.22575 0.156002 2.99897 0.188906 2.81697C0.2053 2.72629 0.222997 2.64145 0.242091 2.56756C0.258572 2.50377 0.284747 2.41267 0.327273 2.33014ZM12.056 0.10133C13.8486 -0.220416 15.3047 0.272207 16.3082 0.902284C16.8075 1.21574 17.2002 1.56608 17.4749 1.8754C17.6119 2.02967 17.7253 2.18023 17.8089 2.31754C17.8755 2.42684 17.9683 2.59841 17.9846 2.78265L17.986 2.80052L17.989 2.85551C18.0187 3.44155 17.9883 4.57197 17.8966 5.5453C17.8494 6.04623 17.7835 6.53338 17.6934 6.89368C17.6505 7.06524 17.5911 7.25558 17.4994 7.40804C17.4552 7.48155 17.3729 7.599 17.2317 7.68531C17.0589 7.791 16.8309 7.82705 16.6095 7.74236C16.3911 7.65883 16.2171 7.50189 16.092 7.36977C15.9563 7.22646 15.8234 7.0524 15.6968 6.86794C15.4429 6.49828 15.18 6.03667 14.934 5.57756C14.687 5.11685 14.4476 4.64082 14.245 4.24421C14.0352 3.8334 13.8762 3.53083 13.7763 3.3779C13.6063 3.11776 13.692 2.77683 13.9676 2.6164C14.2433 2.45597 14.6045 2.53679 14.7745 2.79694C14.9137 3.00991 15.102 3.37304 15.3015 3.76367C15.5082 4.1685 15.7402 4.62967 15.9805 5.07796C16.2056 5.49806 16.4301 5.89138 16.6371 6.20129C16.6716 5.98007 16.7023 5.72394 16.7284 5.44725C16.817 4.50718 16.8437 3.43344 16.8179 2.91485C16.8124 2.90425 16.8043 2.88906 16.7921 2.86908C16.7498 2.79959 16.6789 2.70222 16.576 2.58637C16.3709 2.35545 16.0616 2.07676 15.6586 1.82379C14.8579 1.32101 13.7094 0.931215 12.2751 1.18865C11.9569 1.24575 11.6499 1.04862 11.5894 0.748362C11.5289 0.448112 11.7378 0.158433 12.056 0.10133ZM11.0802 5.00328C11.0986 4.69815 11.3756 4.46486 11.699 4.48221C12.3933 4.51947 12.8726 4.69413 13.2578 4.95279C13.4406 5.07555 13.5897 5.20899 13.7155 5.32727C13.8507 5.45436 13.9429 5.54759 14.0586 5.64653C14.2987 5.85171 14.317 6.20167 14.0996 6.4282C13.8822 6.65473 13.5114 6.67204 13.2713 6.46687C13.1578 6.36978 13.0472 6.26341 12.9553 6.17561C12.98 6.24689 12.9896 6.32395 12.9811 6.40307C12.9811 6.40622 12.9811 6.41267 12.9814 6.42334C12.9818 6.43994 12.9843 6.49732 12.984 6.54311C12.9837 6.59237 12.9809 6.6716 12.96 6.7584C12.9389 6.84575 12.8913 6.97569 12.7741 7.09168C12.5506 7.31287 12.1794 7.3212 11.9451 7.11029C11.763 6.94648 11.717 6.69859 11.8103 6.49241C11.8102 6.48901 11.8101 6.48543 11.8099 6.48153C11.8096 6.47307 11.8093 6.46319 11.809 6.45306C11.8084 6.43322 11.8079 6.40753 11.8085 6.37993C11.809 6.35262 11.8107 6.31728 11.8159 6.27816C11.8562 5.97491 12.1493 5.7599 12.4707 5.79792C12.4775 5.79872 12.4842 5.79967 12.4909 5.80069C12.3096 5.69733 12.0569 5.61 11.6324 5.58722C11.3091 5.56987 11.0619 5.30842 11.0802 5.00328ZM7.0007 4.48129C7.32455 4.48129 7.58709 4.72906 7.58709 5.0347C7.58709 5.34033 7.32455 5.5881 7.0007 5.5881C6.86669 5.5881 6.7381 5.59175 6.61434 5.59992C6.78086 5.70768 6.88388 5.8938 6.86792 6.09752C6.85239 6.29559 6.82782 6.4965 6.79956 6.68467C6.7541 6.98727 6.45733 7.19781 6.13668 7.15491C5.81603 7.11201 5.59296 6.83193 5.6384 6.52933C5.6638 6.36028 5.68511 6.18444 5.69832 6.01588C5.70602 5.91757 5.74051 5.82715 5.79452 5.75053C5.50289 5.84923 5.23809 6.0004 4.98705 6.22361C4.75134 6.4332 4.38019 6.42276 4.15811 6.20031C3.93604 5.97785 3.9471 5.62762 4.18281 5.41803C5.04076 4.65518 6.0083 4.4813 7.0007 4.48129ZM7.74718 4.95606C7.74718 4.49773 7.70996 3.9735 7.56272 3.58884C7.49069 3.40067 7.40802 3.28882 7.33298 3.22884C7.27318 3.18106 7.19183 3.14311 7.03806 3.15237C6.71487 3.17184 6.43615 2.94033 6.41552 2.63531C6.3949 2.3303 6.64018 2.06726 6.96337 2.0478C7.40569 2.02116 7.78899 2.14296 8.09088 2.38422C8.37751 2.61328 8.55358 2.91977 8.66574 3.2128C8.88688 3.79052 8.91996 4.48019 8.91996 4.95606C8.91996 5.26169 8.65742 5.50946 8.33357 5.50946C8.00973 5.50946 7.74719 5.26169 7.74718 4.95606ZM9.41319 4.95606C9.41319 4.56463 9.40675 3.91492 9.55203 3.37547C9.62499 3.10453 9.75199 2.79608 9.99619 2.55908C10.2663 2.29689 10.6344 2.167 11.0606 2.20928C11.3826 2.24124 11.6163 2.51358 11.5824 2.81754C11.5486 3.12149 11.26 3.34199 10.9379 3.31004C10.8587 3.30218 10.8491 3.31894 10.837 3.33065C10.799 3.36753 10.7393 3.46021 10.6887 3.64808C10.5868 4.02626 10.586 4.52494 10.586 4.95606C10.586 5.26169 10.3234 5.50946 9.99959 5.50946C9.67574 5.50946 9.4132 5.26169 9.41319 4.95606Z" fill="black" fill-opacity="0.9"/></svg>`;
const ICON_CROSS = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.09091 6L12 10.9091L10.9091 12L6 7.09091L1.09091 12L0 10.9091L4.90909 6L0 1.09091L1.09091 0L6 4.90909L10.9091 0L12 1.09091L7.09091 6Z" fill="#23272F"/></svg>`;
const ICON_DIR = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path opacity="0.5" fill-rule="evenodd" clip-rule="evenodd" d="M9.98755 6.52566H6.52566V9.98755L7.73094 8.78226L8.47434 9.52566L6 12L3.52566 9.52566L4.26906 8.78226L5.47434 9.98755V6.52566H2.01245L3.21774 7.73094L2.47434 8.47434L0 6L2.47434 3.52566L3.21774 4.26906L2.01245 5.47434H5.47434V2.01245L4.26906 3.21774L3.52566 2.47434L6 0L8.47434 2.47434L7.73094 3.21774L6.52566 2.01245V5.47434H9.98755L8.78226 4.26906L9.52566 3.52566L12 6L9.52566 8.47434L8.78226 7.73094L9.98755 6.52566Z" fill="black"/></svg>`;
const ICON_BACK = `<svg width="12" height="10" viewBox="0 0 12 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M2.25045 3.22306H8.47305C10.4209 3.22306 12 4.74013 12 6.61153C12 8.48293 10.4209 10 8.47305 10H7.00348V8.87051H8.47305C9.77163 8.87051 10.8243 7.85913 10.8243 6.61153C10.8243 5.36393 9.77163 4.35255 8.47305 4.35255H2.25045L4.77392 6.77694L3.94261 7.57561L0 3.7878L3.94261 0L4.77392 0.79867L2.25045 3.22306Z" fill="#23272F"/></svg>`;
const ICON_CHEVRON = `<svg width="6" height="10" viewBox="0 0 6 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.04473 10L5.96321e-07 8.94584L3.91053 5L5.02214e-07 1.05416L1.04473 5.9091e-08L6 5L1.04473 10Z" fill="#23272F"/></svg>`;
const ICON_EDIT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16.474 5.408a2.109 2.109 0 1 1 2.981 2.981L7.593 20.25H4.75v-2.844L16.474 5.408Z" stroke="#23272F" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.4142 1.58579C11.8047 1.97631 11.8047 2.60948 11.4142 3L4.70711 9.70711C4.31658 10.0976 3.68342 10.0976 3.29289 9.70711L0.585786 7C0.195262 6.60948 0.195262 5.97631 0.585786 5.58579C0.97631 5.19526 1.60948 5.19526 2 5.58579L4 7.58579L10 1.58579C10.3905 1.19526 11.0237 1.19526 11.4142 1.58579Z" fill="#1d9e4b"/></svg>`;
const ICON_REFRESH = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M6 1.5C4.20064 1.5 2.68549 2.64744 2.12945 4.24999H3.75V5.24999H0.75V2.24999H1.75V3.55638C2.58465 1.99269 4.2185 0.916667 6.10641 0.916667C8.31533 0.916667 10.1734 2.38672 10.7658 4.39972L9.80622 4.68197C9.33057 3.06369 7.83233 1.88889 6.10641 1.88889C4.55 1.88889 3.19531 2.83833 2.62187 4.24999H3.75L6 1.5Z" fill="#23272F"/><path fill-rule="evenodd" clip-rule="evenodd" d="M6 10.5C7.79936 10.5 9.31451 9.35256 9.87055 7.75001H8.25V6.75001H11.25V9.75001H10.25V8.44362C9.41535 10.0073 7.7815 11.0833 5.89359 11.0833C3.68467 11.0833 1.82661 9.61328 1.23423 7.60028L2.19378 7.31803C2.66943 8.93631 4.16767 10.1111 5.89359 10.1111C7.45 10.1111 8.80469 9.16167 9.37813 7.75001H8.25L6 10.5Z" fill="#23272F"/></svg>`;

// ── Prop types (moved here from the old React devtoolsUI; React re-exports) ──
export interface ToggleControl {
  enabled: boolean;
  onToggle: (next: boolean) => void;
}
export interface BypassControl {
  isBypassed: (entity: string) => boolean;
  onToggle: (entity: string) => void;
}
export interface RequestBypassControl {
  isAvailable: boolean;
  onSet: (method: string, pathname: string, isBypassed: boolean) => Promise<void> | void;
  onList: () => Promise<string[]>;
}
export interface DevtoolsPanelProps {
  title: string;
  entities: Record<string, number>;
  runtime: { delay: number; errorRate: number };
  onRuntimeChange: (patch: { delay?: number; errorRate?: number }) => void;
  onFetchRecords: (entity: string) => Promise<unknown[]>;
  onResetEntity: (entity: string) => Promise<unknown[]>;
  onUpdateRecord: (entity: string, id: string, patch: Record<string, unknown>) => Promise<unknown>;
  onFetchRequestLog: () => Promise<RequestLogEntry[]>;
  onClearRequestLog?: () => Promise<void> | void;
  onArmOneShotOverride: (entity: string, patch: OneShotOverrideEntry) => Promise<void> | void;
  onPeekOneShotOverride: (entity: string) => Promise<OneShotOverrideEntry | undefined>;
  onExportSnapshot: () => Promise<StoreSnapshot>;
  onImportSnapshot: (snapshot: StoreSnapshot) => Promise<void> | void;
  onCopyRecordCurl: (entity: string, id: string) => Promise<void> | void;
  onOpenDocs?: () => void;
  onOpen?: () => void;
  mockNetwork?: ToggleControl;
  bypass?: BypassControl;
  requestBypass?: RequestBypassControl;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────
const METHOD_COLORS: Record<string, string> = { GET: '#0451a5', POST: '#098658', PUT: '#a06600', PATCH: '#a06600', DELETE: '#c0392b' };
const JSON_SYNTAX_COLORS = { key: '#0451a5', string: '#a31515', number: '#098658', keyword: '#0000ff' };
const JSON_TOKEN_REGEX = /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

interface JsonToken { text: string; color?: string; }
function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(JSON_TOKEN_REGEX)) {
    const index = match.index ?? 0;
    if (index > lastIndex) tokens.push({ text: text.slice(lastIndex, index) });
    const value = match[0]!;
    if (value.startsWith('"')) {
      const split = /^(.*")(\s*:)?$/.exec(value)!;
      tokens.push({ text: split[1]!, color: split[2] ? JSON_SYNTAX_COLORS.key : JSON_SYNTAX_COLORS.string });
      if (split[2]) tokens.push({ text: split[2] });
    } else if (value === 'true' || value === 'false' || value === 'null') {
      tokens.push({ text: value, color: JSON_SYNTAX_COLORS.keyword });
    } else {
      tokens.push({ text: value, color: JSON_SYNTAX_COLORS.number });
    }
    lastIndex = index + value.length;
  }
  if (lastIndex < text.length) tokens.push({ text: text.slice(lastIndex) });
  return tokens;
}
function highlightedJson(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const token of tokenizeJson(text)) {
    if (token.color) {
      const span = document.createElement('span');
      span.style.color = token.color;
      span.textContent = token.text;
      frag.appendChild(span);
    } else {
      frag.appendChild(document.createTextNode(token.text));
    }
  }
  return frag;
}
function recordId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const id = (value as Record<string, unknown>).id;
  return id === undefined ? undefined : String(id);
}
function pathnameOnly(path: string): string {
  const q = path.indexOf('?');
  return q === -1 ? path : path.slice(0, q);
}
function randomWindowPosition(width: number, height: number): { x: number; y: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const maxX = Math.max(24, vw - width - 24);
  const maxY = Math.max(24, vh - height - 24);
  return { x: 24 + Math.random() * Math.max(1, maxX - 24), y: 24 + Math.random() * Math.max(1, maxY - 24) };
}

// ── DOM helper ───────────────────────────────────────────────────────────────
interface ElOpts {
  style?: Style;
  class?: string;
  text?: string;
  html?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, opts: ElOpts = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.style) Object.assign(node.style, opts.style);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.html !== undefined) node.innerHTML = opts.html;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  if (opts.on) for (const [k, fn] of Object.entries(opts.on)) node.addEventListener(k, fn as EventListener);
  for (const child of children) node.append(child);
  return node;
}
function iconSpan(svg: string): HTMLSpanElement {
  return el('span', { style: { display: 'flex' }, html: svg });
}

// ── Reusable pieces ──────────────────────────────────────────────────────────
function switchEl(checked: boolean, label: string, onChange: () => void, small = false): HTMLElement {
  const width = small ? 28 : 38;
  const height = small ? 15 : 20;
  const knob = small ? 11 : 16;
  const travel = width - knob - 4;
  const knobEl = el('span', { style: { position: 'absolute', top: '2px', left: '2px', width: `${knob}px`, height: `${knob}px`, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(35,39,47,.3)', transition: 'transform .15s ease', transform: checked ? `translateX(${travel}px)` : 'translateX(0)' } });
  // Flip the element's own visuals immediately, then notify the host. The host
  // usually re-renders (replacing this element), but the in-place update means a
  // caller holding this exact node still sees the new state synchronously.
  const activate = () => {
    checked = !checked;
    outer.setAttribute('aria-checked', String(checked));
    outer.style.background = checked ? SWITCH_ON : SWITCH_OFF;
    knobEl.style.transform = checked ? `translateX(${travel}px)` : 'translateX(0)';
    onChange();
  };
  const outer = el('span', {
    attrs: { role: 'switch', 'aria-checked': String(checked), 'aria-label': label, tabindex: '0' },
    style: { display: 'inline-flex', alignItems: 'center', flex: 'none', width: `${width}px`, height: `${height}px`, borderRadius: '99px', position: 'relative', cursor: 'pointer', background: checked ? SWITCH_ON : SWITCH_OFF, transition: 'background .15s ease' },
    on: {
      click: (e) => { e.stopPropagation(); activate(); },
      keydown: (e) => { const ke = e as KeyboardEvent; if (ke.key === 'Enter' || ke.key === ' ') { e.preventDefault(); e.stopPropagation(); activate(); } },
    },
  });
  outer.append(knobEl);
  return outer;
}
function rowEl(children: Node[], opts: { onClick?: () => void; testId?: string; hoverable?: boolean } = {}): HTMLElement {
  const hoverable = opts.hoverable ?? Boolean(opts.onClick);
  const attrs: Record<string, string> = {};
  if (opts.testId) attrs['data-testid'] = opts.testId;
  const row = el('div', {
    class: hoverable ? 'mp-hover-item' : undefined,
    attrs,
    style: { boxSizing: 'border-box', display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: '16px', gap: '16px', width: '100%', minHeight: '48px', background: '#fff', borderBottom: `1px solid ${BORDER}`, flex: 'none', cursor: opts.onClick ? 'pointer' : '' },
    on: opts.onClick ? { click: () => opts.onClick!() } : undefined,
  }, children);
  return row;
}
function iconButton(svg: string, title: string, onClick: () => void, short = false): HTMLButtonElement {
  return el('button', {
    class: 'mp-icon-btn',
    attrs: { type: 'button', title, 'aria-label': title },
    style: { boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: short ? '46px' : '48px', padding: '18px', border: 'none', borderLeft: `1px solid ${BORDER}`, background: 'transparent', cursor: 'pointer', flex: 'none' },
    on: { click: onClick },
  }, [el('span', { class: 'mp-fade-icon', html: svg })]);
}
interface HeaderOpts {
  title: string;
  icon: 'logo' | 'dir';
  onClose?: () => void; closeLabel?: string;
  onBack?: () => void; backLabel?: string;
  onReset?: () => void; resetLabel?: string;
  extraActions?: Node[];
  drag?: { down: (e: PointerEvent) => void; move: (e: PointerEvent) => void; up: (e: PointerEvent) => void };
}
function panelHeader(o: HeaderOpts): HTMLElement {
  const titleCluster = el('div', {
    style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: o.icon === 'logo' ? '12px' : '8px', minWidth: '0', flex: '1 1 auto', height: '100%', cursor: o.drag ? 'grab' : '', touchAction: o.drag ? 'none' : '', userSelect: o.drag ? 'none' : '' },
  }, [
    iconSpan(o.icon === 'logo' ? ICON_LOGO : ICON_DIR),
    el('span', { text: o.title, style: { fontFamily: FONT_UI, fontWeight: o.icon === 'logo' ? '700' : '600', fontSize: o.icon === 'logo' ? '16px' : '14px', lineHeight: '16px', color: TEXT, whiteSpace: 'nowrap' } }),
  ]);
  if (o.drag) {
    titleCluster.addEventListener('pointerdown', (e) => o.drag!.down(e as PointerEvent));
    titleCluster.addEventListener('pointermove', (e) => o.drag!.move(e as PointerEvent));
    titleCluster.addEventListener('pointerup', (e) => o.drag!.up(e as PointerEvent));
  }
  const actions = el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', flex: 'none' } });
  for (const extra of o.extraActions ?? []) actions.append(extra);
  if (o.onReset) actions.append(iconButton(ICON_REFRESH, o.resetLabel ?? 'Reset', o.onReset));
  if (o.onBack) actions.append(iconButton(ICON_BACK, o.backLabel ?? 'Back', o.onBack, true));
  if (o.onClose) actions.append(iconButton(ICON_CROSS, o.closeLabel ?? 'Close', o.onClose));
  return el('div', {
    style: { boxSizing: 'border-box', display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: '0 0 0 16px', gap: '16px', width: '100%', height: '48px', background: '#fff', borderBottom: `1px solid ${BORDER}`, flex: 'none' },
  }, [titleCluster, actions]);
}

// ── Data window (draggable per-entity records viewer/editor) ──────────────────
interface DataWindowHandle { el: HTMLElement; setZ: (z: number) => void; entity: string; id: string; }
function createDataWindow(
  props: DevtoolsPanelProps,
  entity: string,
  id: string,
  start: { x: number; y: number },
  hooks: { onFocus: () => void; onClose: () => void },
): DataWindowHandle {
  let pos = { ...start };
  let records: unknown[] | null = null;
  let editText: string | null = null;
  let error: string | null = null;
  let saving = false;
  let failArmed = false;
  let delayDraft = '';
  let drag: { startX: number; startY: number; originX: number; originY: number } | null = null;

  const root = el('div', {
    style: { boxSizing: 'border-box', position: 'fixed', left: `${pos.x}px`, top: `${pos.y}px`, display: 'flex', flexDirection: 'column', width: '620px', maxWidth: '92vw', height: '420px', maxHeight: '80vh', border: `1px solid ${BORDER}`, borderRadius: '12px', background: '#fff', overflow: 'hidden', boxShadow: WINDOW_SHADOW, fontFamily: FONT_UI },
    on: { mousedown: () => hooks.onFocus() },
  });
  const body = el('div', { style: { position: 'relative', width: '100%', flex: '1 1 auto', minHeight: '0', overflow: 'hidden' } });

  void props.onFetchRecords(entity).then((r) => { records = r; render(); });
  void props.onPeekOneShotOverride(entity).then((entry) => { failArmed = Boolean(entry?.failNext); render(); });

  function onPointerDown(e: PointerEvent) {
    hooks.onFocus();
    drag = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    pos = { x: drag.originX + (e.clientX - drag.startX), y: drag.originY + (e.clientY - drag.startY) };
    root.style.left = `${pos.x}px`;
    root.style.top = `${pos.y}px`;
  }
  function onPointerUp() { drag = null; }

  async function toggleFailNext() { failArmed = !failArmed; await props.onArmOneShotOverride(entity, { failNext: failArmed }); render(); }
  async function armDelay() {
    const ms = Number(delayDraft);
    if (!Number.isFinite(ms) || ms <= 0) return;
    await props.onArmOneShotOverride(entity, { delayNext: ms });
    delayDraft = ''; render();
  }
  async function handleReset() { records = await props.onResetEntity(entity); render(); }
  function startEdit() { editText = JSON.stringify(records, null, 2); error = null; render(); }
  function cancelEdit() { editText = null; error = null; render(); }
  async function saveEdit() {
    if (editText === null) return;
    let parsed: unknown;
    try { parsed = JSON.parse(editText); } catch { error = 'Invalid JSON.'; render(); return; }
    if (!Array.isArray(parsed)) { error = 'Must be a JSON array of records.'; render(); return; }
    saving = true; error = null; render();
    try {
      const originalById = new Map((records ?? []).map((r) => [recordId(r), r]));
      for (const record of parsed) {
        const rid = recordId(record);
        if (rid === undefined) continue;
        const original = originalById.get(rid);
        if (original === undefined) continue;
        if (JSON.stringify(original) === JSON.stringify(record)) continue;
        await props.onUpdateRecord(entity, rid, record as Record<string, unknown>);
      }
      records = await props.onFetchRecords(entity);
      editText = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to save.';
    } finally {
      saving = false; render();
    }
  }

  function render() {
    const editing = editText !== null;
    root.replaceChildren();

    const extraActions = editing
      ? [iconButton(ICON_CROSS, `Cancel editing ${entity}`, cancelEdit), iconButton(ICON_CHECK, `Save ${entity} changes`, () => void saveEdit())]
      : [iconButton(ICON_EDIT, `Edit ${entity} records`, startEdit)];
    root.append(panelHeader({
      title: entity, icon: 'dir', extraActions,
      onReset: editing || records === null ? undefined : () => void handleReset(), resetLabel: `Reset ${entity}`,
      onClose: hooks.onClose, closeLabel: `Close ${entity} window`,
      drag: { down: onPointerDown, move: onPointerMove, up: onPointerUp },
    }));

    // Controls bar (fail/delay next).
    const onDelayDraft = (e: Event) => { delayDraft = (e.target as HTMLInputElement).value; };
    const delayInput = el('input', { class: 'mp-number-input', attrs: { type: 'number', min: '0', 'aria-label': `Delay next ${entity} request (ms)` }, style: numberInput, on: { input: onDelayDraft, change: onDelayDraft } });
    delayInput.value = delayDraft;
    root.append(el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: '16px', padding: '8px 16px', borderBottom: `1px solid ${BORDER}`, flex: 'none' } }, [
      el('span', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
        switchEl(failArmed, `Fail next ${entity} request`, () => void toggleFailNext(), true),
        el('span', { text: 'Fail next request', style: rowLabel }),
      ]),
      el('span', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [
        el('span', { text: 'Delay next', style: rowLabel }),
        delayInput,
        el('span', { text: 'ms', style: faded }),
        el('button', { attrs: { type: 'button' }, style: smallButton, text: 'Arm', on: { click: () => void armDelay() } }),
      ]),
    ]));

    // Body.
    body.replaceChildren();
    if (editing) {
      const pre = el('pre', { attrs: { 'aria-hidden': 'true' }, style: { margin: '0', position: 'absolute', inset: '0', padding: '16px', boxSizing: 'border-box', fontFamily: FONT_CODE, fontSize: '14px', lineHeight: '20px', fontWeight: '700', color: TEXT, background: '#fff', overflow: 'auto', whiteSpace: 'pre', pointerEvents: 'none' } });
      pre.append(highlightedJson(editText!));
      const textarea = el('textarea', {
        attrs: { spellcheck: 'false', wrap: 'off', 'aria-label': `Edit ${entity} records as JSON` },
        style: { margin: '0', position: 'absolute', inset: '0', width: '100%', height: '100%', padding: '16px', boxSizing: 'border-box', fontFamily: FONT_CODE, fontSize: '14px', lineHeight: '20px', fontWeight: '700', color: 'transparent', caretColor: TEXT, background: 'transparent', border: 'none', outline: 'none', resize: 'none', whiteSpace: 'pre', overflow: 'auto' },
        on: {
          input: (e) => { editText = (e.target as HTMLTextAreaElement).value; pre.replaceChildren(highlightedJson(editText)); },
          change: (e) => { editText = (e.target as HTMLTextAreaElement).value; pre.replaceChildren(highlightedJson(editText)); },
          scroll: (e) => { const t = e.target as HTMLTextAreaElement; pre.scrollTop = t.scrollTop; pre.scrollLeft = t.scrollLeft; },
        },
      });
      textarea.value = editText!;
      textarea.disabled = saving;
      body.append(pre, textarea);
      queueMicrotask(() => textarea.focus());
    } else if (records === null) {
      body.append(el('div', { text: 'loading…', style: { margin: '0', padding: '16px', fontFamily: FONT_CODE, fontSize: '14px', color: TEXT } }));
    } else {
      const scroll = el('div', { style: { position: 'absolute', inset: '0', overflow: 'auto' } });
      records.forEach((record, index) => {
        const rid = recordId(record);
        const wrap = el('div', { style: { borderBottom: index < records!.length - 1 ? `1px solid ${BORDER}` : 'none' } });
        if (rid !== undefined) {
          wrap.append(el('div', { style: { display: 'flex', justifyContent: 'flex-end', padding: '8px 16px 0' } }, [
            el('button', { attrs: { type: 'button', 'aria-label': `Copy curl for ${entity} ${rid}` }, style: smallButton, text: 'Copy as curl', on: { click: () => void props.onCopyRecordCurl(entity, rid) } }),
          ]));
        }
        const pre = el('pre', { style: { margin: '0', padding: '16px', boxSizing: 'border-box', fontFamily: FONT_CODE, fontSize: '14px', lineHeight: '20px', fontWeight: '700', color: TEXT, background: '#fff' } });
        pre.append(highlightedJson(JSON.stringify(record, null, 2)));
        wrap.append(pre);
        scroll.append(wrap);
      });
      body.append(scroll);
    }
    root.append(body);

    if (error !== null) {
      root.append(el('div', { text: error, style: { padding: '8px 16px', fontFamily: FONT_UI, fontSize: '12px', fontWeight: '600', color: '#c0392b', borderTop: `1px solid ${BORDER}`, flex: 'none' } }));
    }
  }

  render();
  return { el: root, entity, id, setZ: (z) => { root.style.zIndex = String(z); } };
}

// ── Request row ──────────────────────────────────────────────────────────────
function requestRow(entry: RequestLogEntry, bypassAvailable: boolean, isBypassed: boolean, onToggle: (m: string, p: string) => void): HTMLElement {
  const statusColor = entry.status >= 500 ? '#c0392b' : entry.status >= 400 ? '#a06600' : '#1d9e4b';
  const pathname = pathnameOnly(entry.path);
  const topLine = el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: '8px', minWidth: '0' } }, [
    el('span', { text: entry.method, style: { ...rowLabel, color: METHOD_COLORS[entry.method] ?? TEXT, flex: 'none' } }),
    el('span', { text: entry.path, attrs: { title: entry.path }, style: { ...rowLabel, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto', minWidth: '0' } }),
    el('span', { text: String(entry.status), style: { ...rowLabel, color: statusColor, flex: 'none' } }),
  ]);
  const bottomChildren: Node[] = [el('span', { text: `${entry.durationMs}ms · ${new Date(entry.timestamp).toLocaleTimeString()}`, style: { ...faded, fontSize: '11px' } })];
  if (bypassAvailable) bottomChildren.push(switchEl(isBypassed, `Use real data for ${entry.method} ${pathname}`, () => onToggle(entry.method, pathname), true));
  const bottomLine = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } }, bottomChildren);
  return rowEl([el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0', width: '100%' } }, [topLine, bottomLine])], { hoverable: false });
}

/**
 * Mounts the devtools panel into `target`. Returns `update` (call with fresh
 * props — e.g. new `entities`/`runtime` — after the host state changes) and
 * `dispose` (removes DOM, listeners and the poll timer).
 */
export function mountDevtoolsPanel(target: HTMLElement, initialProps: DevtoolsPanelProps): { update: (next: DevtoolsPanelProps) => void; dispose: () => void } {
  let props = initialProps;
  let open = false;
  let view: 'main' | 'list' | 'requests' = 'main';
  let requests: RequestLogEntry[] = [];
  let bypassedRequestKeys = new Set<string>();
  let importError: string | null = null;
  let entityFilter = '';
  let entityScrollTop = 0;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  const windows: DataWindowHandle[] = [];
  let order: string[] = [];

  if (typeof document !== 'undefined' && !document.getElementById(STYLE_TAG_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_TAG_ID;
    style.textContent = STYLE_TAG_CSS;
    document.head.appendChild(style);
  }

  const container = el('div', {});
  target.append(container);
  const windowLayer = el('div', {});
  target.append(windowLayer);

  function openPanel() { open = true; props.onOpen?.(); startPolling(); render(); }
  function closePanel() { open = false; stopPolling(); render(); }

  function startPolling() {
    stopPolling();
    if (view !== 'requests' || !open) return;
    const poll = async () => {
      requests = await props.onFetchRequestLog();
      if (props.requestBypass?.isAvailable) bypassedRequestKeys = new Set(await props.requestBypass.onList());
      renderPanel();
    };
    void poll();
    pollTimer = setInterval(() => void poll(), 1000);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; } }

  async function clearRequests() { await props.onClearRequestLog?.(); requests = await props.onFetchRequestLog(); renderPanel(); }
  async function toggleRequestBypass(method: string, pathname: string) {
    if (!props.requestBypass?.isAvailable) return;
    const key = `${method.toUpperCase()} ${pathname}`;
    const next = !bypassedRequestKeys.has(key);
    await props.requestBypass.onSet(method, pathname, next);
    if (next) bypassedRequestKeys.add(key); else bypassedRequestKeys.delete(key);
    renderPanel();
  }

  function focusWindow(id: string) { order = [...order.filter((e) => e !== id), id]; applyZ(); }
  function applyZ() { for (const w of windows) w.setZ(1000000 + order.indexOf(w.id)); }
  function openEntity(entity: string) {
    const existing = windows.find((w) => w.entity === entity);
    if (existing) { focusWindow(existing.id); return; }
    const { x, y } = randomWindowPosition(620, 320);
    const id = `${entity}-${windows.length}-${Math.random().toString(36).slice(2, 8)}`;
    const handle = createDataWindow(props, entity, id, { x, y }, { onFocus: () => focusWindow(id), onClose: () => closeWindow(id) });
    windows.push(handle);
    order.push(id);
    windowLayer.append(handle.el);
    applyZ();
  }
  function closeWindow(id: string) {
    const i = windows.findIndex((w) => w.id === id);
    if (i !== -1) { windows[i]!.el.remove(); windows.splice(i, 1); }
    order = order.filter((e) => e !== id);
  }

  async function resetAllEntities() { for (const entity of Object.keys(props.entities)) await props.onResetEntity(entity); }
  async function handleExport() {
    const snapshot = await props.onExportSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mockingpug-snapshot.json'; a.click();
    URL.revokeObjectURL(url);
  }
  async function handleImportFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    importError = null;
    try { await props.onImportSnapshot(JSON.parse(await file.text()) as StoreSnapshot); }
    catch { importError = 'Invalid snapshot file.'; renderPanel(); }
  }

  // Preserve focus + caret across a full panel rebuild (keyed by aria-label).
  function withFocusPreserved(rebuild: () => void) {
    const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const key = active && container.contains(active) ? active.getAttribute('aria-label') : null;
    const selStart = key ? active!.selectionStart : null;
    const selEnd = key ? active!.selectionEnd : null;
    rebuild();
    if (key) {
      const next = container.querySelector<HTMLInputElement>(`[aria-label="${CSS.escape(key)}"]`);
      if (next) { next.focus(); try { if (selStart !== null) next.setSelectionRange(selStart, selEnd); } catch { /* non-text input */ } }
    }
  }

  function buildToggle(): HTMLElement {
    return el('button', {
      class: 'mp-icon-btn',
      attrs: { type: 'button', 'aria-label': open ? 'Hide mockingpug devtools' : 'Open mockingpug devtools' },
      style: { boxSizing: 'border-box', position: 'fixed', bottom: '12px', right: '12px', zIndex: '1000001', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', border: `1px solid ${BORDER}`, boxShadow: WINDOW_SHADOW, borderRadius: '9999px', cursor: 'pointer', padding: '0' },
      on: { click: () => (open ? closePanel() : openPanel()) },
    }, [open ? el('span', { class: 'mp-fade-icon', html: ICON_CROSS }) : el('span', { style: { filter: 'drop-shadow(0px 16px 32px rgba(0,0,0,0.15))', display: 'flex' }, html: ICON_LOGO })]);
  }

  function buildMain(): HTMLElement[] {
    const parts: HTMLElement[] = [];
    parts.push(panelHeader({ title: props.title, icon: 'logo', onClose: closePanel, closeLabel: 'Close devtools' }));

    const mkNav = (label: string, onClick: () => void, count?: number) => {
      const labelSpan = el('span', { style: rowLabel }, [document.createTextNode(count === undefined ? label : `${label} `)]);
      if (count !== undefined) labelSpan.append(el('span', { text: `(${count})`, style: faded }));
      const btn = el('button', { attrs: { type: 'button' }, style: unstyledButton, on: { click: onClick } }, [rowEl([labelSpan, iconSpan(ICON_CHEVRON)], { hoverable: true })]);
      return btn;
    };
    parts.push(mkNav('Mock Data', () => { view = 'list'; renderPanel(); }, Object.keys(props.entities).length));
    parts.push(mkNav('Requests', () => { view = 'requests'; startPolling(); renderPanel(); }));

    if (props.onOpenDocs) {
      parts.push(el('button', { attrs: { type: 'button', 'aria-label': 'API Docs' }, style: unstyledButton, on: { click: () => props.onOpenDocs!() } }, [
        rowEl([el('span', { text: 'API Docs', style: rowLabel, attrs: { 'aria-hidden': 'true' } }), el('span', { text: '↗', style: faded, attrs: { 'aria-hidden': 'true' } })], { hoverable: true }),
      ]));
    }
    if (props.mockNetwork) {
      parts.push(rowEl([el('span', { text: 'Mock network', style: rowLabel }), switchEl(props.mockNetwork.enabled, 'Mock network', () => props.mockNetwork!.onToggle(!props.mockNetwork!.enabled))]));
    }

    const onDelay = (e: Event) => props.onRuntimeChange({ delay: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) });
    const delayInput = el('input', { class: 'mp-number-input', attrs: { type: 'number', min: '0', 'aria-label': 'Delay (ms)' }, style: numberInput, on: { input: onDelay, change: onDelay } });
    delayInput.value = String(props.runtime.delay);
    parts.push(rowEl([el('span', { text: 'Delay', style: rowLabel }), el('span', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [delayInput, el('span', { text: 'ms', style: faded })])]));

    const onErr = (e: Event) => props.onRuntimeChange({ errorRate: Math.min(1, Math.max(0, Number((e.target as HTMLInputElement).value) || 0)) });
    const errInput = el('input', { class: 'mp-number-input', attrs: { type: 'number', min: '0', max: '1', step: '0.1', 'aria-label': 'Error rate (0-1)' }, style: numberInput, on: { input: onErr, change: onErr } });
    errInput.value = String(props.runtime.errorRate);
    parts.push(rowEl([el('span', { text: 'Error rate', style: rowLabel }), errInput]));
    return parts;
  }

  function buildList(): HTMLElement[] {
    const parts: HTMLElement[] = [];
    parts.push(panelHeader({ title: 'Mock Data', icon: 'dir', onBack: () => { view = 'main'; renderPanel(); }, backLabel: 'Back to settings', onReset: () => void resetAllEntities(), resetLabel: 'Reset all entities' }));

    const importInput = el('input', { attrs: { type: 'file', accept: 'application/json', 'aria-label': 'Import snapshot file' }, style: { display: 'none' }, on: { change: (e) => void handleImportFile(e.target as HTMLInputElement) } });
    parts.push(el('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', padding: '8px 16px', borderBottom: `1px solid ${BORDER}`, flex: 'none' } }, [
      el('button', { attrs: { type: 'button' }, style: smallButton, text: 'Export', on: { click: () => void handleExport() } }),
      el('button', { attrs: { type: 'button' }, style: smallButton, text: 'Import', on: { click: () => importInput.click() } }),
      importInput,
    ]));
    if (importError) parts.push(el('div', { text: importError, style: { padding: '4px 16px 8px', fontFamily: FONT_UI, fontSize: '12px', fontWeight: '600', color: '#c0392b', flex: 'none' } }));

    const onFilter = (e: Event) => { entityFilter = (e.target as HTMLInputElement).value; entityScrollTop = 0; renderPanel(); };
    const filter = el('input', { attrs: { type: 'text', placeholder: 'Filter entities…', 'aria-label': 'Filter entities' }, style: filterInput, on: { input: onFilter, change: onFilter } });
    filter.value = entityFilter;
    parts.push(el('div', { style: { padding: '8px 16px', borderBottom: `1px solid ${BORDER}`, flex: 'none' } }, [filter]));

    const wrap = el('div', { style: { position: 'relative', width: '100%' } });
    const filtered = Object.entries(props.entities).filter(([e]) => e.toLowerCase().includes(entityFilter.trim().toLowerCase()));
    const visibleRowCount = Math.ceil(ENTITY_LIST_HEIGHT / ENTITY_ROW_HEIGHT) + ENTITY_LIST_OVERSCAN * 2;
    const startIndex = Math.max(0, Math.floor(entityScrollTop / ENTITY_ROW_HEIGHT) - ENTITY_LIST_OVERSCAN);
    const visible = filtered.slice(startIndex, startIndex + visibleRowCount);

    const scroll = el('div', { attrs: { 'data-testid': 'entity-list-scroll' }, style: { maxHeight: `${ENTITY_LIST_HEIGHT}px`, overflowY: 'auto' }, on: { scroll: (e) => { entityScrollTop = (e.target as HTMLElement).scrollTop; renderPanel(); } } });
    if (filtered.length === 0) {
      scroll.append(rowEl([el('span', { text: 'No matching entities.', style: faded })], { hoverable: false }));
    } else {
      const spacer = el('div', { style: { position: 'relative', height: `${filtered.length * ENTITY_ROW_HEIGHT}px` } });
      const inner = el('div', { style: { position: 'absolute', top: `${startIndex * ENTITY_ROW_HEIGHT}px`, left: '0', right: '0' } });
      for (const [entity, count] of visible) {
        const left = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' } }, [
          iconSpan(ICON_DIR),
          (() => { const s = el('span', { style: rowLabel }, [document.createTextNode(`${entity} `)]); s.append(el('span', { text: `(${count})`, style: faded })); return s; })(),
        ]);
        const rightChildren: Node[] = [];
        if (props.bypass) rightChildren.push(switchEl(props.bypass.isBypassed(entity), `Bypass ${entity}`, () => { props.bypass!.onToggle(entity); renderPanel(); }, true));
        rightChildren.push(el('button', { attrs: { type: 'button', 'aria-label': `Open ${entity} records` }, style: { boxSizing: 'border-box', display: 'flex', padding: '0', margin: '0', border: 'none', background: 'transparent', cursor: 'pointer' }, on: { click: (e) => { e.stopPropagation(); openEntity(entity); } } }, [iconSpan(ICON_CHEVRON)]));
        inner.append(rowEl([left, el('span', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, rightChildren)], { onClick: () => openEntity(entity), testId: `entity-row-${entity}` }));
      }
      spacer.append(inner);
      scroll.append(spacer);
    }
    // Restore scroll position after rebuild.
    queueMicrotask(() => { scroll.scrollTop = entityScrollTop; });
    wrap.append(scroll);
    wrap.append(el('div', { style: { position: 'absolute', top: '0', left: '0', right: '0', height: '24px', background: 'linear-gradient(180deg,#fff,rgba(255,255,255,0))', pointerEvents: 'none' } }));
    wrap.append(el('div', { style: { position: 'absolute', bottom: '0', left: '0', right: '0', height: '24px', background: 'linear-gradient(0deg,#fff,rgba(255,255,255,0))', pointerEvents: 'none' } }));
    parts.push(wrap);
    return parts;
  }

  function buildRequests(): HTMLElement[] {
    const parts: HTMLElement[] = [];
    parts.push(panelHeader({ title: 'Requests', icon: 'dir', onBack: () => { view = 'main'; stopPolling(); renderPanel(); }, backLabel: 'Back to settings', onReset: props.onClearRequestLog ? () => void clearRequests() : undefined, resetLabel: 'Clear request log' }));
    const list = el('div', { style: { maxHeight: '269px', overflowY: 'auto' } });
    if (requests.length === 0) {
      list.append(rowEl([el('span', { text: 'No requests yet.', style: faded })], { hoverable: false }));
    } else {
      const available = props.requestBypass?.isAvailable ?? false;
      for (const entry of requests) {
        const bypassed = bypassedRequestKeys.has(`${entry.method.toUpperCase()} ${pathnameOnly(entry.path)}`);
        list.append(requestRow(entry, available, bypassed, (m, p) => void toggleRequestBypass(m, p)));
      }
    }
    parts.push(list);
    return parts;
  }

  function renderPanel() {
    withFocusPreserved(() => {
      container.replaceChildren();
      container.append(buildToggle());
      if (!open) return;
      const panel = el('div', { style: { boxSizing: 'border-box', position: 'fixed', bottom: '52px', right: '12px', zIndex: '999999', display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '320px', border: `1px solid ${BORDER}`, borderRadius: '12px 12px 0px 12px', background: '#fff', overflow: 'hidden', fontFamily: FONT_UI, boxShadow: WINDOW_SHADOW } });
      const parts = view === 'main' ? buildMain() : view === 'list' ? buildList() : buildRequests();
      for (const p of parts) panel.append(p);
      container.append(panel);
    });
  }
  const render = renderPanel;

  render();

  return {
    update: (next) => { props = next; render(); },
    dispose: () => {
      stopPolling();
      for (const w of windows) w.el.remove();
      container.remove();
      windowLayer.remove();
    },
  };
}
