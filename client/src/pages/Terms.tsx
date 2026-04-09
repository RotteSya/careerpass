import { Link } from "wouter";

export default function Terms() {
  return (
    <div className="min-h-screen bg-[var(--color-warm-white)] text-foreground">
      {/* Header */}
      <header className="border-b border-black/10 bg-white px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-[var(--color-notion-blue)] font-semibold text-[15px] hover:opacity-80 transition-opacity">
            ← 就活パス CareerPass
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-[26px] leading-tight tracking-[-0.625px] font-bold mb-2">利用規約</h1>
        <p className="text-[14px] text-[var(--color-warm-gray-500)] mb-8">Terms of Service — 最終更新日：2025年4月5日</p>

        <div className="bg-white border border-black/10 rounded-2xl shadow-[rgba(0,0,0,0.04)_0px_4px_18px,rgba(0,0,0,0.027)_0px_2.025px_7.84688px,rgba(0,0,0,0.02)_0px_0.8px_2.925px,rgba(0,0,0,0.01)_0px_0.175px_1.04062px] p-8 space-y-8 text-[14px] leading-relaxed">

          <section>
            <h2 className="text-xl font-semibold mb-3">第1条（適用）</h2>
            <p className="text-muted-foreground">
              本利用規約（以下「本規約」）は、就活パス CareerPass（以下「本サービス」）の利用条件を定めるものです。ユーザーの皆さまには、本規約に従って本サービスをご利用いただきます。本サービスにアクセスまたは利用することで、本規約に同意したものとみなされます。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">第2条（サービスの内容）</h2>
            <p className="text-muted-foreground">
              本サービスは、日本での就職活動を支援する AI エージェントサービスです。主な機能として、AI による ES（エントリーシート）作成支援、模擬面接練習、企業情報リサーチ、就活スケジュール管理（Google カレンダー連携）、Gmail による就活メール自動検出、Telegram Bot を通じた AI エージェントとの対話を提供します。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">第3条（ユーザー登録）</h2>
            <p className="text-muted-foreground">
              本サービスの利用にはユーザー登録が必要です。登録時には正確な情報を提供してください。虚偽の情報を提供した場合、アカウントを停止または削除することがあります。アカウントの管理はユーザー自身の責任において行ってください。パスワードの漏洩や不正利用が疑われる場合は、速やかに運営者までご連絡ください。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">第4条（Google サービス連携）</h2>
            <p className="text-muted-foreground mb-3">
              本サービスは Google OAuth 2.0 を通じて Gmail および Google カレンダーと連携します。連携を行うことで、以下に同意したものとみなされます：
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
              <li>就活関連メールの自動検出・分類のための Gmail 読み取り</li>
              <li>就活スケジュールの自動登録のための Google カレンダーへのアクセス</li>
              <li>Google アカウントのメールアドレスおよびプロフィール情報の取得</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              Google 連携はダッシュボードからいつでも解除できます。連携解除後、取得済みの Google トークンは速やかに削除されます。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">第5条（禁止事項）</h2>
            <p className="text-muted-foreground mb-3">ユーザーは以下の行為を行ってはなりません：</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 font-medium">カテゴリ</th>
                    <th className="text-left py-2 font-medium">禁止内容</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">不正アクセス</td>
                    <td className="py-2">他のユーザーのアカウントへの不正アクセス、システムへの攻撃</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">虚偽情報</td>
                    <td className="py-2">虚偽の個人情報の登録、なりすまし行為</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">商業利用</td>
                    <td className="py-2">本サービスの無断転売、商業目的での大量利用</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">迷惑行為</td>
                    <td className="py-2">他のユーザーや運営者への嫌がらせ、誹謗中傷</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4">法令違反</td>
                    <td className="py-2">著作権侵害、個人情報保護法違反、その他法令に違反する行為</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">第6条（知的財産権）</h2>
            <p className="text-muted-foreground">
              本サービスに関する著作権、商標権その他の知的財産権は運営者に帰属します。ユーザーが本サービスを通じて作成した ES・面接対策コンテンツの著作権はユーザーに帰属します。ただし、運営者はサービス改善のため、匿名化・統計化した形でコンテンツを分析する権利を有します。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">第7条（免責事項）</h2>
            <p className="text-muted-foreground">
              本サービスは AI を活用したサービスであり、生成されるコンテンツ（ES・面接対策等）の正確性・完全性・適切性を保証するものではありません。本サービスの利用により生じた損害について、運営者は故意または重大な過失がある場合を除き、責任を負いません。就職活動の結果（採用・不採用）について、本サービスは一切の保証を行いません。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">第8条（サービスの変更・停止）</h2>
            <p className="text-muted-foreground">
              運営者は、ユーザーへの事前通知なく本サービスの内容を変更、または提供を一時停止・終了することがあります。これによりユーザーに生じた損害について、運営者は責任を負いません。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">第9条（準拠法・管轄裁判所）</h2>
            <p className="text-muted-foreground">
              本規約の解釈にあたっては日本法を準拠法とします。本サービスに関して紛争が生じた場合には、運営者の所在地を管轄する裁判所を専属的合意管轄とします。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">第10条（お問い合わせ）</h2>
            <p className="text-muted-foreground">
              本規約に関するご質問は以下までお問い合わせください：<br />
              運営者：佘令钊<br />
              メール：<a href="mailto:raysyadesu@gmail.com" className="text-primary hover:underline">raysyadesu@gmail.com</a><br />
              サービス URL：<a href="https://careerpax.com" className="text-primary hover:underline">https://careerpax.com</a>
            </p>
          </section>

        </div>
      </main>

      <footer className="border-t border-black/10 mt-16 px-6 py-8 text-center text-[var(--color-warm-gray-500)] text-[12px]">
        <p>© 2025 就活パス CareerPass. All rights reserved.</p>
        <div className="flex justify-center gap-6 mt-2">
          <Link href="/privacy" className="hover:text-[var(--color-notion-blue)] transition-colors">プライバシーポリシー</Link>
          <Link href="/terms" className="hover:text-[var(--color-notion-blue)] transition-colors">利用規約</Link>
        </div>
      </footer>
    </div>
  );
}
