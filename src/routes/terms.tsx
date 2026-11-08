import { Link, createFileRoute } from '@tanstack/react-router'
import { LegalPage, LegalSection } from '~/components/forge/legal'

export const Route = createFileRoute('/terms')({
  head: () => ({ meta: [{ title: 'Terms of service · source.code' }] }),
  component: Terms,
})

const sections: Array<[string, string]> = [
  ['service', 'The service'],
  ['accounts', 'Accounts and organizations'],
  ['content', 'Your content'],
  ['use', 'Using it well'],
  ['agents', 'Agents and automation'],
  ['plans', 'Plans, billing and limits'],
  ['availability', 'Availability'],
  ['software', 'Our software and its license'],
  ['ending', 'Ending your use'],
  ['open', 'Still to be decided'],
]

const link =
  'font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground'

function Terms() {
  return (
    <LegalPage
      title="Terms of service"
      updated="Draft of November 5, 2026"
      intro="The deal between you and source.code, in plain words: what you can count on, and what we ask of you."
      sections={sections}
    >
      <LegalSection id="service" title="The service">
        <p>
          source.code is operated by Marco Procopio. It hosts git repositories,
          reviews changes and lands them under policies you write, and works
          with any model, harness and agent you choose to connect. By creating
          an account or using the service you agree to these terms and to the{' '}
          <Link to="/privacy" className={link}>
            privacy policy
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="accounts" title="Accounts and organizations">
        <ul>
          <li>
            One login belongs to one person. That person can act as their own
            account and as any organization they belong to, one at a time.
          </li>
          <li>
            You are responsible for what happens under your login and your
            tokens. Keep your password safe, and tell us if you think someone
            else has access.
          </li>
          <li>
            Any signed-in person can create an organization and becomes its
            first owner. The organization, not the person, owns what is created
            in it. It always has at least one owner, and its owners decide who
            else belongs and with what role.
          </li>
          <li>
            Do not pretend to be someone else. Addresses are generated so that
            nobody can sign up as another person&rsquo;s name or a
            company&rsquo;s, and some names are never available.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="content" title="Your content">
        <p>
          <b>It stays yours.</b> Your code, issues, reviews and releases, and
          the licenses you choose for them, belong to you or to the organization
          that owns them.
        </p>
        <p>
          You give us only the permission the service needs: to store and back
          up your content, to show it as you have set it (anyone can see a
          public repository), and to send it where you tell us to, such as a
          mirror on another host. You are responsible for having the right to
          put content here, including history you import from another host.
        </p>
      </LegalSection>

      <LegalSection id="use" title="Using it well">
        <ul>
          <li>
            Do not attack, overload or try to break the service or other
            people&rsquo;s accounts.
          </li>
          <li>
            Do not use it to spread malware, to break the law, or to harm
            people.
          </li>
          <li>
            Automation is welcome. Agents and CI clone a lot, and that counts
            toward your plan like any other transfer, so keep it within it.
          </li>
        </ul>
        <p>
          If something breaks these rules we will say what and why, and give you
          time to fix it where we reasonably can.
        </p>
      </LegalSection>

      <LegalSection id="agents" title="Agents and automation">
        <ul>
          <li>
            When you give an agent or a script a token, what it does with that
            token is your action. Tokens are scoped, and can lose scopes but
            never gain them.
          </li>
          <li>
            Agents follow the same policies as people. An agent cannot approve
            its own change, and production secrets are never available to
            agents.
          </li>
          <li>
            Agents never receive a secret value. They run commands that have
            them, and what the command prints is scrubbed.
          </li>
          <li>
            What an agent costs to run is between you and the provider you
            chose. We do not resell compute or tokens.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="plans" title="Plans, billing and limits">
        <p>
          Plans cover storage, transfer, history and seats. The details and
          prices are on the{' '}
          <Link to="/pricing" className={link}>
            pricing page
          </Link>
          . In short:
        </p>
        <ul>
          <li>
            A trial needs a card, and nothing is charged until it ends. Cancel
            before then and you pay nothing, and your data stays downloadable.
          </li>
          <li>
            Going over your limits never breaks anything. Extra storage and
            transfer are billed after the month, and you can set a cap.
          </li>
          <li>
            If you stop paying, your history stays readable and downloadable for
            90 days. Going over your limits pauses new pushes and never deletes
            anything. Mirrors on other hosts keep their copy.
          </li>
          <li>
            Agents use the same seats as people, and their use of storage and
            transfer counts toward your allowance.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="availability" title="Availability">
        <p>
          We work to keep the service running, and say how it is doing on the{' '}
          <Link to="/status" className={link}>
            status page
          </Link>
          . A written uptime commitment is part of the enterprise plan. We do
          not offer or support a self-hosted version.
        </p>
      </LegalSection>

      <LegalSection id="software" title="Our software and its license">
        <p>
          The server and web app are public so you can read them, and are
          published under the Business Source License 1.1: production use of
          the server code needs a commercial license, and each version
          converts to Apache-2.0 four years after it is published. The CLI
          and SDK in `cli/` and `sdk/typescript/` are Apache-2.0 and can be
          used and forked freely. Using the hosted service does not require
          a license. Parts we did not write keep their own licenses.
        </p>
      </LegalSection>

      <LegalSection id="ending" title="Ending your use">
        <ul>
          <li>
            You can stop at any time. Your repositories are plain git, so you
            can clone them first, and mirrors keep copies elsewhere.
          </li>
          <li>
            We may suspend an account that breaks these terms. We will say why,
            and tell you before where we reasonably can.
          </li>
          <li>
            After an account ends, history stays readable and downloadable for
            90 days.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="open" title="Still to be decided">
        <p>
          These need an answer, and a lawyer&rsquo;s review, before the service
          takes real accounts:
        </p>
        <ul>
          <li>The contact address for questions and notices.</li>
          <li>
            The country whose law applies, and where disagreements are settled.
          </li>
          <li>
            What we promise and what we do not about the service&rsquo;s
            quality, and the limit of our responsibility if something goes
            wrong.
          </li>
          <li>How we give notice when these terms or prices change.</li>
          <li>The minimum age to use the service.</li>
        </ul>
      </LegalSection>
    </LegalPage>
  )
}
