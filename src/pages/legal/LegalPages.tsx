import { LegalLayout } from "@/components/legal/LegalLayout";

/**
 * Placeholder legal documents. Replace the body of each section
 * with the official corporate text when available. Structure and
 * routes are stable.
 */

function Placeholder({ topic }: { topic: string }) {
  return (
    <>
      <p>
        Este documento descreve as práticas oficiais do Operix relacionadas a
        <strong> {topic}</strong>. O conteúdo final será publicado pelo time
        jurídico responsável.
      </p>
      <h2>1. Escopo</h2>
      <p>
        Define o alcance das obrigações, partes envolvidas e contexto de uso da
        plataforma proprietária Operix™.
      </p>
      <h2>2. Responsabilidades</h2>
      <p>
        Descreve os deveres das partes, incluindo titulares de dados,
        operadores, controladores e administradores do sistema.
      </p>
      <h2>3. Direitos do usuário</h2>
      <p>
        Inclui revogação de consentimento, exportação de dados, retificação,
        portabilidade e solicitação de exclusão.
      </p>
      <h2>4. Auditoria e compliance</h2>
      <p>
        Registros são mantidos com fins de auditoria empresarial e compliance
        internacional (GDPR, LGPD e padrões equivalentes).
      </p>
      <h2>5. Contato</h2>
      <p>
        Solicitações jurídicas devem ser direcionadas ao responsável legal
        designado pela operação do Operix.
      </p>
    </>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title="Termos de Uso" subtitle="Condições gerais de utilização da plataforma.">
      <Placeholder topic="termos de uso, licenciamento e responsabilidades" />
    </LegalLayout>
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Política de Privacidade" subtitle="Como coletamos, usamos e protegemos seus dados.">
      <Placeholder topic="coleta, finalidade e bases legais de tratamento de dados" />
    </LegalLayout>
  );
}

export function GdprPage() {
  return (
    <LegalLayout title="GDPR / LGPD" subtitle="Conformidade com regulamentações internacionais de proteção de dados.">
      <Placeholder topic="direitos do titular, bases legais e medidas de salvaguarda" />
    </LegalLayout>
  );
}

export function CookiesPage() {
  return (
    <LegalLayout title="Política de Cookies" subtitle="Uso de cookies, armazenamento local e tecnologias equivalentes.">
      <Placeholder topic="categorias de cookies, consentimento e gerenciamento de preferências" />
    </LegalLayout>
  );
}

export function DataProcessingPage() {
  return (
    <LegalLayout title="Processamento de Dados" subtitle="Acordo de processamento de dados operacionais e empresariais.">
      <Placeholder topic="finalidade, segurança, retenção e subprocessadores autorizados" />
    </LegalLayout>
  );
}
