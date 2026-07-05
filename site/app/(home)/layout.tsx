// The home page has its own fully custom header/footer (see HomeView.tsx),
// so it deliberately skips fumadocs-ui's `HomeLayout` chrome that every
// other route under this app gets.
export default function Layout({ children }: LayoutProps<'/'>) {
  return children;
}
