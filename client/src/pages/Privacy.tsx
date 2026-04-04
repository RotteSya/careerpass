import { Link } from "wouter";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-primary font-bold text-lg hover:opacity-80 transition-opacity">
            ← 就活パス CareerPass
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">プライバシーポリシー</h1>
        <p className="text-muted-foreground mb-8">Privacy Policy — 最終更新日：2025年4月5日</p>

        <div className="prose prose-invert max-w-none space-y-8 text-sm leading-relaxed">

          <section>
            <h2 className="text-xl font-semibold mb-3">1. はじめに</h2>
            <p className="text-muted-foreground">
              就活パス CareerPass（以下「本サービス」）は、佘令钊（以下「運営者」）が提供する就職活動支援AIサービスです。本プライバシーポリシーは、本サービスがお客様の個人情報をどのように収集、使用、保護するかを説明します。本サービスをご利用いただくことで、本ポリシーに同意したものとみなされます。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. 収集する情報</h2>
            <p className="text-muted-foreground mb-3">本サービスは以下の情報を収集します：</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 font-medium">情報の種類</th>
                    <th className="text-left py-2 pr-4 font-medium">収集方法</th>
                    <th className="text-left py-2 font-medium">目的</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">メールアドレス・パスワード</td>
                    <td className="py-2 pr-4">ユーザー登録時</td>
                    <td className="py-2">アカウント認証・ログイン</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">氏名・生年月日・学歴・大学名</td>
                    <td className="py-2 pr-4">プロフィール設定時</td>
                    <td className="py-2">ES・面接対策の個人最適化</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">Google アカウント情報（メール・カレンダー）</td>
                    <td className="py-2 pr-4">Google OAuth 連携時</td>
                    <td className="py-2">就活スケジュール管理・Gmail 監視</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">Telegram ユーザー ID・ユーザー名</td>
                    <td className="py-2 pr-4">Telegram Bot 連携時</td>
                    <td className="py-2">AI エージェントとの対話</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">AI 対話履歴・就活記録</td>
                    <td className="py-2 pr-4">サービス利用中</td>
                    <td className="py-2">パーソナライズされた就活支援</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4">アクセスログ・デバイス情報</td>
                    <td className="py-2 pr-4">自動収集</td>
                    <td className="py-2">サービス改善・セキュリティ</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Google ユーザーデータの取り扱い</h2>
            <p className="text-muted-foreground mb-3">
              本サービスは Google OAuth 2.0 を通じて以下の Google ユーザーデータにアクセスします。取得したデータの利用は以下の目的に限定されます：
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-2">
              <li><strong className="text-foreground">Gmail 読み取り権限（gmail.readonly）</strong>：就職活動関連メール（面接通知・選考結果・説明会案内等）を自動検出し、カレンダーへの登録およびユーザーへの通知に使用します。</li>
              <li><strong className="text-foreground">Google カレンダー権限（calendar）</strong>：就活スケジュールを自動登録・管理するために使用します。</li>
              <li><strong className="text-foreground">Google プロフィール情報（email, profile）</strong>：アカウント識別およびサービス内でのユーザー認証に使用します。</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              取得した Google ユーザーデータは、上記目的以外には使用しません。第三者への販売・共有は行いません。Google API サービスから取得したデータの使用および転送は、
              <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline ml-1">Google API サービスのユーザーデータポリシー</a>（Limited Use 要件を含む）に準拠します。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. 情報の利用目的</h2>
            <p className="text-muted-foreground">
              収集した情報は以下の目的のみに使用します：就職活動支援 AI サービスの提供・改善、ユーザーアカウントの管理・認証、就活スケジュールの自動管理、パーソナライズされた ES・面接対策コンテンツの生成、サービスに関する重要なお知らせの送信、不正利用の防止およびセキュリティの確保。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. 情報の共有・第三者提供</h2>
            <p className="text-muted-foreground">
              運営者は、以下の場合を除き、お客様の個人情報を第三者に提供しません：お客様の同意がある場合、法令に基づく開示が必要な場合、サービス提供に必要な業務委託先（クラウドインフラ等）への提供（守秘義務契約締結済み）。本サービスが利用する主な外部サービスは、Google（認証・カレンダー・Gmail）、Telegram（Bot 通信）、Resend（メール送信）です。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. データの保存・セキュリティ</h2>
            <p className="text-muted-foreground">
              お客様のデータは暗号化された安全なデータベースに保存されます。パスワードは bcrypt によりハッシュ化して保存します。セッショントークンは JWT により署名・検証されます。Google OAuth トークンはデータベースに暗号化して保存し、アクセストークンの有効期限管理を行います。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. お客様の権利</h2>
            <p className="text-muted-foreground">
              お客様は以下の権利を有します：保有する個人情報の開示請求、個人情報の訂正・削除の請求、Google 連携の解除（ダッシュボードの「連携解除」ボタンから随時可能）、アカウントの削除（お問い合わせにより対応）。これらの権利行使については、下記のお問い合わせ先までご連絡ください。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Cookie・トラッキング</h2>
            <p className="text-muted-foreground">
              本サービスはセッション管理のために localStorage を使用します。第三者の広告トラッキング Cookie は使用しません。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. 未成年者のプライバシー</h2>
            <p className="text-muted-foreground">
              本サービスは 13 歳未満のお子様を対象としていません。13 歳未満のお子様から意図せず個人情報を収集した場合は、速やかに削除いたします。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. ポリシーの変更</h2>
            <p className="text-muted-foreground">
              本ポリシーは必要に応じて更新されることがあります。重要な変更がある場合は、本サービス上でお知らせします。変更後も本サービスをご利用いただいた場合、変更後のポリシーに同意したものとみなされます。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">11. お問い合わせ</h2>
            <p className="text-muted-foreground">
              本プライバシーポリシーに関するご質問・ご要望は、以下までお問い合わせください：<br />
              運営者：佘令钊<br />
              メール：<a href="mailto:raysyadesu@gmail.com" className="text-primary hover:underline">raysyadesu@gmail.com</a><br />
              サービス URL：<a href="https://careerpax.com" className="text-primary hover:underline">https://careerpax.com</a>
            </p>
          </section>

        </div>
      </main>

      <footer className="border-t border-border mt-16 px-6 py-8 text-center text-muted-foreground text-sm">
        <p>© 2025 就活パス CareerPass. All rights reserved.</p>
        <div className="flex justify-center gap-6 mt-2">
          <Link href="/privacy" className="hover:text-foreground transition-colors">プライバシーポリシー</Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">利用規約</Link>
        </div>
      </footer>
    </div>
  );
}
