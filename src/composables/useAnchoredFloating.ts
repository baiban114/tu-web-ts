import { onBeforeUnmount, reactive, ref, watch, type Ref } from 'vue'

export type FloatingPlacement = 'top' | 'right'

export interface FloatingAnchorRect {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface FloatingPosition {
  top: number
  left: number
  zIndex: number
}

export interface AnchoredFloatingOptions {
  visible: Ref<boolean>
  getAnchorRect: () => FloatingAnchorRect | DOMRect | null | undefined
  placement?: FloatingPlacement
  offset?: number
  zIndex?: number
}

export function useAnchoredFloating(options: AnchoredFloatingOptions) {
  const position = reactive<FloatingPosition>({
    top: 0,
    left: 0,
    zIndex: options.zIndex ?? 20,
  })
  const anchorVersion = ref(0)
  let rafId = 0

  const compute = () => {
    if (!options.visible.value) return
    const rect = options.getAnchorRect()
    if (!rect) {
      options.visible.value = false
      return
    }
    const offset = options.offset ?? 10
    if ((options.placement ?? 'top') === 'right') {
      position.top = rect.top - offset
      position.left = rect.right + offset
    } else {
      position.top = rect.top - offset
      position.left = rect.left + rect.width / 2
    }
    anchorVersion.value += 1
  }

  const scheduleUpdate = () => {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      rafId = 0
      compute()
    })
  }

  const bind = () => {
    window.addEventListener('scroll', scheduleUpdate, true)
    window.addEventListener('resize', scheduleUpdate)
  }

  const unbind = () => {
    window.removeEventListener('scroll', scheduleUpdate, true)
    window.removeEventListener('resize', scheduleUpdate)
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }

  watch(
    options.visible,
    (visible) => {
      if (visible) {
        bind()
        scheduleUpdate()
      } else {
        unbind()
      }
    },
    { flush: 'post' },
  )

  onBeforeUnmount(unbind)

  return {
    position,
    updatePosition: scheduleUpdate,
    anchorVersion,
  }
}
