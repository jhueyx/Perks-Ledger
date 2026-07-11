// AI Advisor Edge Function — calls Claude Haiku with the user's benefit context.
//
// Required secret (Dashboard → Edge Functions → ask-perks-advisor → Secrets):
//   ANTHROPIC_API_KEY
//
// Deploy:
//   supabase functions deploy ask-perks-advisor --project-ref rsbvddlhismetljqoqre

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { question, context, mode } = await req.json();
    if (!question?.trim() || !context?.trim()) {
      return new Response(JSON.stringify({ error: 'Missing question or context' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = mode === 'choose'
      ? 'You are a credit card recommendation advisor. The user is deciding whether to get a NEW premium card, not optimizing one they already have. You are given the cards they already own, a catalog of candidate cards (annual fee, max possible annual credit value, top earn-rate categories, point valuation), and possibly their monthly spending by category. Do a realistic breakeven: fee vs. credits they would actually use (not the theoretical max) plus the extra point value earned from their spending on that card versus what they earn today. Call out overlap with cards they already own. If no candidate card clears its fee for this person, say so plainly. Use bullet points for comparisons. Be direct and specific with numbers. No disclaimers.'
      : 'You are a concise credit card perks advisor. The user tracks their credit card benefits in the Perks Ledger app. Give practical, specific advice based on their actual data. Use bullet points for lists. Be direct and actionable. No disclaimers.';

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Here is my credit card benefit data:\n\n${context}\n\nQuestion: ${question}`,
          },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Anthropic API ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    const answer = data.content?.[0]?.text ?? 'No response generated.';

    return new Response(JSON.stringify({ answer }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
