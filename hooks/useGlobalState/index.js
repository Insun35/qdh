import React from 'react'
import globalHook from 'use-global-hook'
import web3state from './web3state'

import random from 'lodash/random'
import pack from 'libs/binpack'
import { signUp as MaciSignUp, publish as MaciPublish } from 'libs/MACI'
import { Keypair, PrivKey } from 'maci-domainobjs'

const initialState = {
  ...web3state.initialState,
  loading: true,
  canvas: {},
  boxes: [],
  cart: [],
  committedVotes: (() => {
    if (typeof window !== 'undefined') {
      try {
        return JSON.parse(localStorage.getItem('committedVotes')) || []
      } catch (err) {
        return []
      }
    }
    return []
  })(),
  balance: (() => {
    if (typeof window !== 'undefined') {
      return parseInt(localStorage.getItem('voiceCredits')) || 120
    }
  })(),
  selected: null,
  voteRootValue: 1,
  voteSquare: 1,
  bribedMode: false,
  signedUp: (() => {
    if (typeof window !== 'undefined') {
      return Boolean(localStorage.getItem('userStateIndex')) || false
    }
  })(),
  userStateIndex: (() => {
    if (typeof window !== 'undefined') {
      return parseInt(localStorage.getItem('userStateIndex')) || null
    }
  })(),
  keyPair: (() => {
    if (typeof window !== 'undefined') {
      const macisk = localStorage.getItem('macisk')
      if (macisk == null) {
        const keyPair = new Keypair()
        localStorage.setItem('macisk', keyPair.privKey.serialize())
        console.log('MACI key generated', keyPair.pubKey.serialize())
        return keyPair
      } else {
        const keyPair = new Keypair(PrivKey.unserialize(macisk))
        console.log('MACI key loaded', keyPair.pubKey.serialize())
        return keyPair
      }
    }
  })(),
}

const actions = {
  ...web3state.actions,
  signUp: async (store, value) => {
    const { chainId } = await store.state.ethersProvider.getNetwork()
    if (chainId === 1) return alert(`Sorry, we are not on mainnet yet. Try other networks.`)
    store.setState({ loading: true })
    const { ethersProvider, maci, keyPair, poapTokenId } = store.state
    const { userStateIndex, voiceCredits } = await MaciSignUp(
      // ethersProvider,
      maci,
      keyPair,
      BigInt(poapTokenId || 0)
    )
    localStorage.setItem('userStateIndex', userStateIndex)
    localStorage.setItem('voiceCredits', voiceCredits)
    store.setState({ signedUp: true, balance: voiceCredits, userStateIndex })
    store.setState({ loading: false })
  },
  selectImage: (store, value) => {
    if (store.state.hasEligiblePOAPtokens !== true) return
    if (store.state.signedUp !== true) return
    store.setState({ selected: value })
  },
  incVote: (store, value) => {
    const voteRootValue = store.state.voteRootValue + 1
    const voteSquare = Math.pow(voteRootValue, 2)
    if (store.state.balance - voteSquare < 0) return
    store.setState({ voteRootValue, voteSquare })
  },
  decVote: (store, value) => {
    if (store.state.voteRootValue <= 1) return
    const voteRootValue = store.state.voteRootValue - 1
    const voteSquare = Math.pow(voteRootValue, 2)
    store.setState({ voteRootValue, voteSquare })
  },
  addToCart: (store, value) => {
    let { cart, selected, voteRootValue, voteSquare } = store.state
    cart.push({ type: 'vote', imageId: selected, voteRootValue, voteSquare })
    store.setState({
      cart: cart,
      selected: null,
      balance: store.state.balance - store.state.voteSquare,
      voteRootValue: 1,
      voteSquare: 1,
    })
  },
  removeFromCart: (store, value) => {
    let { cart } = store.state
    const [{ voteSquare }] = cart.splice(value, 1)
    store.setState({ cart, balance: store.state.balance + (voteSquare || 0) })
  },
  vote: async ({ state, ...store }, value) => {
    if (state.loading) return
    const { chainId } = await state.ethersProvider.getNetwork()
    if (chainId === 1) return alert(`Sorry, we are not on mainnet yet. Try other networks.`)
    store.setState({ loading: true })
    const { maci, keyPair, userStateIndex, cart, committedVotes } = state
    const _cart = cart.slice().reverse()
    for (const [index, item] of _cart.reverse().entries()) {
      item.nonce = _cart.length - index
      const { imageId: voteOptionIndex, voteRootValue: voteWeight, nonce } = item
      try {
        const tx = await MaciPublish(
          maci,
          keyPair,
          BigInt(userStateIndex),
          BigInt(voteOptionIndex || 0),
          BigInt(voteWeight || 0),
          BigInt(nonce)
        )
        item.tx = tx
        committedVotes.push(item)
      } catch (error) {
        // TODO make sure failed transactions are not removed from cart
      }
    }
    if (store.bribedMode) {
      /*
      There are several ways to cast an invalid vote:

      Use an invalid signature
      Use more voice credits than available
      Use an incorrect nonce
      Use an invalid state index
      Vote for a vote option that does not exist
      */
    }
    // TODO update local storate balance
    committedVotes.forEach(item => cart.splice(cart.indexOf(item), 1))
    localStorage.setItem(
      'committedVotes',
      JSON.stringify(
        committedVotes,
        (key, value) => (typeof value === 'bigint' ? value.toString() : value) // return everything else unchanged
      )
    )
    localStorage.setItem('voiceCredits', state.balance)
    store.setState({ loading: false, committedVotes, cart })
  },
  imBeingBribed: (store, value) => {
    store.setState({ bribedMode: !store.state.bribedMode })
  },
  changeKey: async ({ state, ...store }, value) => {
    const keyPair = new Keypair()
    // localStorage.setItem('macisk', keyPair.privKey.serialize())
    store.setState({ keyPair: keyPair })
    // alert(`Voting key changed to:\n${keyPair.pubKey.serialize()}`)
    // console.log('MACI key changed', keyPair.pubKey.serialize())
    // await MaciChangeKey(state.ethersProvider, state.keyPair, state.userStateIndex, BigInt(0))

    let { cart } = state
    cart.push({ type: 'keychange', keyPair, voteOptionIndex: 0, voteWeight: 0 })
    store.setState({ cart })
  },

  setLoading: (store, value) => {
    store.setState({ loading: value })
  },
  fetchImages: async store => {
    const res = await fetch('/api/image')
    const images = await res.json()
    const initialSize = 100
    images.map(image => {
      image.w = initialSize
      image.h = initialSize
      image.color = '#' + (Math.random() * 0xfffff * 1000000).toString(16).slice(0, 6)
      return image
    })
    // const BOXES = Array.from(Array(10)).map(_ => {
    //   const _size = (2 ^ random(1, 10)) * 20
    //   return {
    //     w: _size,
    //     h: _size,
    //     color: '#' + (Math.random() * 0xfffff * 1000000).toString(16).slice(0, 6),
    //   }
    // })
    if (images.length > 0) {
      const { canvas, boxes } = pack(images, 'maxrects')
      store.setState({ canvas, boxes })
    }
  },
}

export default globalHook(React, initialState, actions)
