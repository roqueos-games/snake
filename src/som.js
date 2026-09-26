// O som do Snake, procedural: nenhum arquivo de áudio, só osciladores. O
// AudioContext é do host (no RoqueOS, o compartilhado com os apps de música;
// fora dele, um próprio), e o jogo só toca quando o contexto já está rodando,
// porque tocar num contexto suspenso enfileira som que sai tudo junto depois.
//
// Os números (notas, envelopes, volumes) são os do componente do RoqueOS antes
// da extração, em 25/09/2026. Só mudou o lugar.

/**
 * @param {{ contexto: () => AudioContext | null }} audio a capacidade `audio` do host
 * @param {() => boolean} estaMudo
 */
export function criarSom(audio, estaMudo) {
  let volume = null
  let dono = null
  // O zumbido grave que acompanha a partida e sobe com os pontos.
  let fundo = null

  const contexto = () => {
    if (estaMudo()) return null
    try {
      const c = audio.contexto()
      if (!c || c.state !== 'running') return null
      // O ganho mestre pertence a UM contexto. Se o host trocar de contexto
      // (o iOS fecha o antigo ao voltar do fundo), recria em vez de ligar num
      // nó de outro contexto, o que lança exceção dentro do laço do jogo.
      if (dono !== c) {
        volume = c.createGain()
        volume.gain.value = 0.5
        volume.connect(c.destination)
        dono = c
      }
      return c
    } catch {
      return null
    }
  }

  const envelope = (c, t0, pico, queda) => {
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(pico, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + queda)
    g.connect(volume)
    return g
  }

  return {
    /** Blip que sobe ao comer: o tom acompanha os pontos, como um combo. */
    comer(n) {
      const c = contexto()
      if (!c) return
      const agora = c.currentTime
      const semitons = [0, 3, 5, 7, 10, 12]
      const midi =
        64 + semitons[n % semitons.length] + 12 * Math.min(2, Math.floor(n / semitons.length))
      const o = c.createOscillator()
      o.type = 'triangle'
      o.frequency.setValueAtTime(440 * Math.pow(2, (midi - 69) / 12), agora)
      o.frequency.exponentialRampToValueAtTime(
        440 * Math.pow(2, (midi - 69 + 4) / 12),
        agora + 0.09,
      )
      o.connect(envelope(c, agora, 0.16, 0.16))
      o.start(agora)
      o.stop(agora + 0.2)
    },
    /** Zumbido que desce, com uma pancada grave, ao morrer. */
    morrer() {
      const c = contexto()
      if (!c) return
      const agora = c.currentTime
      const o = c.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(320, agora)
      o.frequency.exponentialRampToValueAtTime(60, agora + 0.4)
      o.connect(envelope(c, agora, 0.2, 0.5))
      o.start(agora)
      o.stop(agora + 0.55)
      const k = c.createOscillator()
      k.type = 'sine'
      k.frequency.setValueAtTime(120, agora)
      k.frequency.exponentialRampToValueAtTime(40, agora + 0.25)
      k.connect(envelope(c, agora, 0.3, 0.3))
      k.start(agora)
      k.stop(agora + 0.32)
    },
    /** Liga o fundo, uma vez só; começa calado e quem dá o nível é o laço. */
    ligarFundo() {
      const c = contexto()
      if (!c || fundo) return
      const ganho = c.createGain()
      ganho.gain.value = 0
      ganho.connect(volume)
      const osciladores = []
      for (const f of [55, 82.4]) {
        const o = c.createOscillator()
        o.type = 'sine'
        o.frequency.value = f
        o.connect(ganho)
        o.start()
        osciladores.push(o)
      }
      fundo = { ganho, osciladores }
    },
    /** @param {number} nivel de 0 a 1 */
    nivelDoFundo(nivel) {
      if (estaMudo() || !fundo) return
      fundo.ganho.gain.value = Math.max(0, Math.min(nivel, 1)) * 0.08
    },
    /** Cala o fundo na hora, sem esperar o próximo quadro (o botão de mudo). */
    calarFundo() {
      if (fundo) fundo.ganho.gain.value = 0
    },
    pararFundo() {
      if (!fundo) return
      try {
        for (const o of fundo.osciladores) o.stop()
        fundo.ganho.disconnect()
      } catch {
        /* já parado */
      }
      fundo = null
    },
  }
}
